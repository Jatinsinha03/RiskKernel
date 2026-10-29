// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts@5.0.2/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts@5.0.2/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts@5.0.2/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts@5.0.2/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts@5.0.2/utils/cryptography/ECDSA.sol";

/*//////////////////////////////////////////////////////////////
                    DEX ROUTER INTERFACES
    Only the swap entry points we need.
      kind 0 -> Uniswap V2 style router
      kind 1 -> Uniswap V3 SwapRouter (params include `deadline`)   <-- USE THIS ON HASHKEY CHAIN
      kind 2 -> Uniswap V3 SwapRouter02 (params have no `deadline`)

    HashKey Chain mainnet values read from the explorer (re-verify before deploying):
      SwapRouter (original V3, selector exactOutput 0xf28c0498 seen in a live trace) 0x56d15cF00b5D853D6eE4CbB1463E6DAD2899fBf5
      WHSK  (18 decimals)  0xB210D2120d57b758EE163cFfb43e73728c471Cf1
      USDT  (6 decimals)   0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029   (use as base asset)
      WHSK/USDT 0.3% pool  0x4ff515761864e7838B0AdB8b5b2B8B7A068905dC   (fee tier value for a Step: 3000)
//////////////////////////////////////////////////////////////*/

interface IV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface IV3RouterWithDeadline {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface IV3Router02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/**
 * @title RiskKernelVault
 * @notice One personal, non-custodial trading vault. The AI agent can only ask the vault to
 *         run swap cycles; the vault itself enforces every rule.
 *
 *  PHASE 1 (Risk Kernel Vault + Policy Cards with signed diffs)
 *    - Owner-held funds in ONE base asset (e.g. a stablecoin). Value is measured in that asset only.
 *    - Mandate: max drawdown, max slippage, max position, max daily volume, approval threshold.
 *    - Allowlists: tokens and routers.
 *    - Policy changes are owner transactions (the wallet confirmation is the signature).
 *      Safer-only changes apply at once. If ANY field gets riskier, the whole change is queued
 *      behind a delay and can be cancelled.
 *    - Circuit breaker: if value falls below the loss floor after a trade, the vault freezes.
 *    - Pause, revoke agent, withdraw (always allowed), unfreeze.
 *    - executeCycle: loss-tolerant cycle (loss capped by the slippage rule). Meant for testnet demos
 *      of the circuit breaker. Disabled on deployments where allowLossTolerantCycles is false.
 *
 *  PHASE 2 (Profit-or-Revert Executor + Human-in-the-Loop threshold)
 *    - executeArbitrage: the whole cycle reverts unless the vault gets back
 *      amountIn + minProfit (minProfit must be > 0).
 *    - Trades larger than mandate.approvalThreshold need an owner EIP-712 signature for that exact
 *      trade (one-time nonce, expiry). Threshold == type(uint128).max means "approvals off".
 *
 *  Deploy (Remix, Injected Provider - MetaMask): msg.sender becomes the owner.
 *  Constructor example (all amounts in base-asset units, e.g. 6 decimals for USDT):
 *    _agent                 0xAgentWallet...
 *    _baseAsset             0xStablecoin...
 *    _mandate               [500, 100, 100000000, 300000000, 340282366920938463463374607431768211455]
 *                           (5% drawdown, 1% slippage, 100 max trade, 300 max per day, approvals off)
 *    _allowedTokens         ["0xTokenA...", "0xTokenB..."]      (base asset is added automatically)
 *    _allowedRouters        ["0xHSKSwapRouter..."]
 *    _policyDelay           120 on testnet (seconds), 900 or more on mainnet
 *    _allowLossTolerantCycles true on testnet demo, false on mainnet
 *
 *  Unaudited hackathon code. Use small funds.
 */
contract RiskKernelVault is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                 TYPES
    //////////////////////////////////////////////////////////////*/

    struct Mandate {
        uint16 maxDrawdownBps; // loss from peak value that freezes the agent (1..5000)
        uint16 maxSlippageBps; // max allowed loss per loss-tolerant cycle (0..1000)
        uint128 maxPositionSize; // largest single trade, base units
        uint128 maxDailyVolume; // total traded per UTC day, base units
        uint128 approvalThreshold; // trades above this need owner approval (max uint128 = off)
    }

    /// @dev A proposed new set of rules. Numbers are the full new values. Lists are changes.
    struct PolicyChange {
        Mandate mandate;
        address[] addTokens;
        address[] removeTokens;
        address[] addRouters;
        address[] removeRouters;
        address newAgent; // address(0) = leave the agent unchanged
    }

    /// @dev One swap. Recipient is always this vault. tokenIn of step 0 and tokenOut of the last step must be the base asset.
    struct Step {
        address router;
        uint8 kind; // 0 = V2, 1 = V3 with deadline, 2 = V3 Router02
        address tokenIn;
        address tokenOut;
        uint24 fee; // V3 fee tier. Ignored for V2
    }

    /// @dev Owner approval for ONE trade. Leave signature empty when not needed.
    struct Approval {
        uint64 expiry;
        uint256 nonce;
        bytes signature;
    }

    enum TradeMode {
        Cycle,
        Arbitrage
    }

    /*//////////////////////////////////////////////////////////////
                               CONSTANTS
    //////////////////////////////////////////////////////////////*/

    uint256 public constant BPS = 10_000;
    uint16 public constant MAX_DRAWDOWN_LIMIT_BPS = 5_000;
    uint16 public constant MAX_SLIPPAGE_LIMIT_BPS = 1_000;
    uint256 public constant MAX_STEPS = 4;
    uint32 public constant MIN_POLICY_DELAY = 60;
    uint32 public constant MAX_POLICY_DELAY = 7 days;
    uint128 public constant APPROVAL_DISABLED = type(uint128).max;

    bytes32 public constant TRADE_APPROVAL_TYPEHASH =
        keccak256("TradeApproval(bytes32 cycleHash,uint256 amountIn,uint256 minReturn,uint64 expiry,uint256 nonce)");

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    address public immutable owner;
    IERC20 public immutable baseAsset;
    uint32 public immutable policyDelay;
    bool public immutable allowLossTolerantCycles;

    address public agent;
    bool public paused;
    bool public frozen;

    Mandate public mandate;
    uint256 public highWaterMark; // peak value in base units (adjusted for deposits and withdrawals)

    uint256 public volumeToday;
    uint64 public volumeDay; // day number of the volume counter

    mapping(address => bool) public isTokenAllowed;
    mapping(address => bool) public isRouterAllowed;
    mapping(uint256 => bool) public approvalNonceUsed;

    bytes32 public pendingPolicyHash; // 0 = nothing queued
    uint64 public pendingPolicyEta;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event VaultCreated(address indexed owner, address indexed agent, address indexed baseAsset, Mandate mandate);
    event Deposited(uint256 amount, uint256 highWaterMark);
    event Withdrawn(address indexed to, uint256 amount, uint256 highWaterMark);
    event PolicyApplied(bytes32 indexed policyHash, bool wasQueued, PolicyChange change);
    event PolicyQueued(bytes32 indexed policyHash, uint64 eta, PolicyChange change);
    event PolicyCancelled(bytes32 indexed policyHash);
    event AgentChanged(address indexed oldAgent, address indexed newAgent);
    event PausedSet(bool paused);
    event CircuitBreakerTripped(uint256 balance, uint256 lossFloor, uint256 highWaterMark);
    event Unfrozen(uint256 newHighWaterMark);
    event ApprovalConsumed(uint256 indexed nonce);
    event TradeExecuted(
        TradeMode indexed mode,
        bytes32 indexed cycleHash,
        uint256 amountIn,
        uint256 returned,
        int256 pnl,
        bool approvalUsed
    );
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error NotOwner();
    error NotAgent();
    error IsPaused();
    error IsFrozen();
    error NotFrozen();
    error ZeroAddress();
    error ZeroAmount();
    error BadMandate();
    error BadPolicyDelay();
    error BaseAssetProtected();
    error PendingPolicyExists();
    error NoPendingPolicy();
    error PolicyHashMismatch();
    error PolicyNotReady(uint64 eta);
    error LossTolerantDisabled();
    error SlippageTooHigh();
    error ProfitRequired();
    error TradeExpired();
    error BadRoute();
    error RouterNotAllowed(address router);
    error TokenNotAllowed(address token);
    error PositionTooLarge();
    error InsufficientBalance();
    error DailyLimitExceeded();
    error ApprovalRequired();
    error ApprovalExpired();
    error ApprovalAlreadyUsed();
    error BadApprovalSigner();
    error ZeroOutput();
    error InsufficientReturn(uint256 returned, uint256 required);

    /*//////////////////////////////////////////////////////////////
                               MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent || msg.sender == address(0)) revert NotAgent();
        _;
    }

    modifier whenActive() {
        if (paused) revert IsPaused();
        if (frozen) revert IsFrozen();
        _;
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(
        address _agent,
        IERC20 _baseAsset,
        Mandate memory _mandate,
        address[] memory _allowedTokens,
        address[] memory _allowedRouters,
        uint32 _policyDelay,
        bool _allowLossTolerantCycles
    ) EIP712("RiskKernelVault", "1") {
        if (address(_baseAsset) == address(0)) revert ZeroAddress();
        if (_policyDelay < MIN_POLICY_DELAY || _policyDelay > MAX_POLICY_DELAY) revert BadPolicyDelay();
        _validateMandate(_mandate);

        owner = msg.sender;
        baseAsset = _baseAsset;
        policyDelay = _policyDelay;
        allowLossTolerantCycles = _allowLossTolerantCycles;
        agent = _agent;
        mandate = _mandate;

        isTokenAllowed[address(_baseAsset)] = true;
        for (uint256 i; i < _allowedTokens.length; ++i) {
            if (_allowedTokens[i] == address(0)) revert ZeroAddress();
            isTokenAllowed[_allowedTokens[i]] = true;
        }
        for (uint256 i; i < _allowedRouters.length; ++i) {
            if (_allowedRouters[i] == address(0)) revert ZeroAddress();
            isRouterAllowed[_allowedRouters[i]] = true;
        }

        emit VaultCreated(msg.sender, _agent, address(_baseAsset), _mandate);
    }

    /*//////////////////////////////////////////////////////////////
                       FUNDS (owner only, always safe)
    //////////////////////////////////////////////////////////////*/

    /// @notice Add base asset. Owner must approve this vault first.
    function deposit(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 beforeBal = baseAsset.balanceOf(address(this));
        baseAsset.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = baseAsset.balanceOf(address(this)) - beforeBal;
        highWaterMark += received;
        emit Deposited(received, highWaterMark);
    }

    /// @notice Take funds out. Works while paused or frozen. The peak value shrinks proportionally
    ///         so a withdrawal is never mistaken for a trading loss.
    function withdraw(uint256 amount, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = baseAsset.balanceOf(address(this));
        if (amount == 0) revert ZeroAmount();
        if (amount > bal) revert InsufficientBalance();

        highWaterMark = (amount == bal) ? 0 : (highWaterMark * (bal - amount)) / bal;
        baseAsset.safeTransfer(to, amount);
        emit Withdrawn(to, amount, highWaterMark);
    }

    /// @notice Recover any token that is NOT the base asset and was sent here by mistake.
    function rescueToken(IERC20 token, address to) external onlyOwner nonReentrant {
        if (address(token) == address(baseAsset)) revert BaseAssetProtected();
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = token.balanceOf(address(this));
        token.safeTransfer(to, amount);
        emit TokenRescued(address(token), to, amount);
    }

    /*//////////////////////////////////////////////////////////////
                  PHASE 1: POLICY CARDS AND SIGNED DIFFS
    //////////////////////////////////////////////////////////////*/

    /// @notice Submit a rule change. Nothing riskier ever applies instantly.
    ///         Safer-only: applied now. Anything riskier: the whole change is queued.
    function submitPolicy(PolicyChange calldata c) external onlyOwner {
        _validatePolicy(c);
        bytes32 h = hashPolicy(c);

        if (isPolicyLooser(c)) {
            if (pendingPolicyHash != bytes32(0)) revert PendingPolicyExists();
            uint64 eta = uint64(block.timestamp) + policyDelay;
            pendingPolicyHash = h;
            pendingPolicyEta = eta;
            emit PolicyQueued(h, eta, c);
        } else {
            _applyPolicy(c);
            emit PolicyApplied(h, false, c);
        }
    }

    /// @notice Activate a queued change after its delay. Must pass the same data that was queued.
    function applyQueuedPolicy(PolicyChange calldata c) external onlyOwner {
        bytes32 queued = pendingPolicyHash;
        if (queued == bytes32(0)) revert NoPendingPolicy();
        if (pendingPolicyEta > block.timestamp) revert PolicyNotReady(pendingPolicyEta);
        bytes32 h = hashPolicy(c);
        if (h != queued) revert PolicyHashMismatch();

        pendingPolicyHash = bytes32(0);
        pendingPolicyEta = 0;
        _validatePolicy(c);
        _applyPolicy(c);
        emit PolicyApplied(h, true, c);
    }

    /// @notice Drop a queued change.
    function cancelQueuedPolicy() external onlyOwner {
        bytes32 queued = pendingPolicyHash;
        if (queued == bytes32(0)) revert NoPendingPolicy();
        pendingPolicyHash = bytes32(0);
        pendingPolicyEta = 0;
        emit PolicyCancelled(queued);
    }

    /// @notice Instant. Removes the agent's power.
    function revokeAgent() external onlyOwner {
        emit AgentChanged(agent, address(0));
        agent = address(0);
    }

    /// @notice Instant kill switch. Blocks the agent. Funds stay withdrawable.
    function pause() external onlyOwner {
        paused = true;
        emit PausedSet(true);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit PausedSet(false);
    }

    /// @notice Clear a circuit-breaker freeze. The peak value restarts from the current balance.
    function unfreeze() external onlyOwner {
        if (!frozen) revert NotFrozen();
        frozen = false;
        highWaterMark = baseAsset.balanceOf(address(this));
        emit Unfrozen(highWaterMark);
    }

    /// @notice True if this change would be queued (anything gets riskier). Used by the UI diff.
    function isPolicyLooser(PolicyChange calldata c) public view returns (bool) {
        Mandate memory m = mandate;
        if (
            c.mandate.maxDrawdownBps > m.maxDrawdownBps || c.mandate.maxSlippageBps > m.maxSlippageBps
                || c.mandate.maxPositionSize > m.maxPositionSize || c.mandate.maxDailyVolume > m.maxDailyVolume
                || c.mandate.approvalThreshold > m.approvalThreshold
        ) return true;
        if (c.addTokens.length != 0 || c.addRouters.length != 0) return true;
        if (c.newAgent != address(0) && c.newAgent != agent) return true;
        return false;
    }

    function hashPolicy(PolicyChange calldata c) public pure returns (bytes32) {
        return keccak256(abi.encode(c));
    }

    /*//////////////////////////////////////////////////////////////
          PHASE 1 + 2: AGENT TRADING (rules enforced here, not by the AI)
    //////////////////////////////////////////////////////////////*/

    /// @notice PHASE 1. Loss-tolerant swap cycle. The vault must get back at least `minReturn`,
    ///         and `minReturn` can be no lower than amountIn minus the slippage rule.
    ///         Only works when allowLossTolerantCycles is true (testnet demos).
    function executeCycle(
        Step[] calldata steps,
        uint256 amountIn,
        uint256 minReturn,
        uint64 deadline,
        Approval calldata approval
    ) external onlyAgent whenActive nonReentrant {
        if (!allowLossTolerantCycles) revert LossTolerantDisabled();
        if (minReturn < (amountIn * (BPS - mandate.maxSlippageBps)) / BPS) revert SlippageTooHigh();
        _executeTrade(TradeMode.Cycle, steps, amountIn, minReturn, deadline, approval);
    }

    /// @notice PHASE 2. Profit-or-revert cycle. If the vault does not end up with at least
    ///         amountIn + minProfit, the whole transaction reverts and only gas is spent.
    function executeArbitrage(
        Step[] calldata steps,
        uint256 amountIn,
        uint256 minProfit,
        uint64 deadline,
        Approval calldata approval
    ) external onlyAgent whenActive nonReentrant {
        if (minProfit == 0) revert ProfitRequired();
        _executeTrade(TradeMode.Arbitrage, steps, amountIn, amountIn + minProfit, deadline, approval);
    }

    function _executeTrade(
        TradeMode mode,
        Step[] calldata steps,
        uint256 amountIn,
        uint256 minReturn,
        uint64 deadline,
        Approval calldata approval
    ) internal {
        if (block.timestamp > deadline) revert TradeExpired();
        _validateRoute(steps);

        uint256 balBefore = baseAsset.balanceOf(address(this));
        _checkLimits(amountIn, balBefore);

        bytes32 cycleHash = hashCycle(steps);
        bool approvalUsed = _checkApproval(cycleHash, amountIn, minReturn, approval);

        uint256 amt = amountIn;
        for (uint256 i; i < steps.length; ++i) {
            amt = _swap(steps[i], amt, deadline);
        }

        uint256 balAfter = baseAsset.balanceOf(address(this));
        uint256 returned = balAfter + amountIn - balBefore;
        if (returned < minReturn) revert InsufficientReturn(returned, minReturn);

        _settle(balAfter);
        emit TradeExecuted(mode, cycleHash, amountIn, returned, int256(returned) - int256(amountIn), approvalUsed);
    }

    /// @dev Raise the peak if we made money. Freeze if value is below the loss floor.
    ///      Does NOT revert on a breach, so the freeze is saved.
    function _settle(uint256 balAfter) internal {
        if (balAfter > highWaterMark) highWaterMark = balAfter;
        uint256 floor_ = lossFloor();
        if (balAfter < floor_) {
            frozen = true;
            emit CircuitBreakerTripped(balAfter, floor_, highWaterMark);
        }
    }

    function _validateRoute(Step[] calldata steps) internal view {
        uint256 n = steps.length;
        if (n < 2 || n > MAX_STEPS) revert BadRoute();
        if (steps[0].tokenIn != address(baseAsset) || steps[n - 1].tokenOut != address(baseAsset)) revert BadRoute();

        for (uint256 i; i < n; ++i) {
            Step calldata s = steps[i];
            if (s.kind > 2 || s.tokenIn == s.tokenOut) revert BadRoute();
            if (!isRouterAllowed[s.router]) revert RouterNotAllowed(s.router);
            if (!isTokenAllowed[s.tokenIn]) revert TokenNotAllowed(s.tokenIn);
            if (!isTokenAllowed[s.tokenOut]) revert TokenNotAllowed(s.tokenOut);
            if (i != 0 && steps[i - 1].tokenOut != s.tokenIn) revert BadRoute();
        }
    }

    function _checkLimits(uint256 amountIn, uint256 balBefore) internal {
        Mandate memory m = mandate;
        if (amountIn == 0) revert ZeroAmount();
        if (amountIn > m.maxPositionSize) revert PositionTooLarge();
        if (amountIn > balBefore) revert InsufficientBalance();

        uint64 today = uint64(block.timestamp / 1 days);
        if (today != volumeDay) {
            volumeDay = today;
            volumeToday = 0;
        }
        if (volumeToday + amountIn > m.maxDailyVolume) revert DailyLimitExceeded();
        volumeToday += amountIn;
    }

    /// @dev PHASE 2. Human-in-the-loop. Returns true if an approval was required and consumed.
    function _checkApproval(bytes32 cycleHash, uint256 amountIn, uint256 minReturn, Approval calldata a)
        internal
        returns (bool)
    {
        if (!requiresApproval(amountIn)) return false;

        if (a.signature.length == 0) revert ApprovalRequired();
        if (block.timestamp > a.expiry) revert ApprovalExpired();
        if (approvalNonceUsed[a.nonce]) revert ApprovalAlreadyUsed();

        bytes32 digest = approvalDigest(cycleHash, amountIn, minReturn, a.expiry, a.nonce);
        if (ECDSA.recover(digest, a.signature) != owner) revert BadApprovalSigner();

        approvalNonceUsed[a.nonce] = true;
        emit ApprovalConsumed(a.nonce);
        return true;
    }

    /// @dev Swaps the full amount in, sends output to this vault, returns what we actually received.
    function _swap(Step calldata s, uint256 amountIn, uint64 deadline) internal returns (uint256 received) {
        IERC20 tIn = IERC20(s.tokenIn);
        IERC20 tOut = IERC20(s.tokenOut);
        uint256 outBefore = tOut.balanceOf(address(this));

        tIn.forceApprove(s.router, amountIn);

        if (s.kind == 0) {
            address[] memory path = new address[](2);
            path[0] = s.tokenIn;
            path[1] = s.tokenOut;
            IV2Router(s.router).swapExactTokensForTokens(amountIn, 0, path, address(this), deadline);
        } else if (s.kind == 1) {
            IV3RouterWithDeadline(s.router).exactInputSingle(
                IV3RouterWithDeadline.ExactInputSingleParams({
                    tokenIn: s.tokenIn,
                    tokenOut: s.tokenOut,
                    fee: s.fee,
                    recipient: address(this),
                    deadline: deadline,
                    amountIn: amountIn,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );
        } else {
            IV3Router02(s.router).exactInputSingle(
                IV3Router02.ExactInputSingleParams({
                    tokenIn: s.tokenIn,
                    tokenOut: s.tokenOut,
                    fee: s.fee,
                    recipient: address(this),
                    amountIn: amountIn,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );
        }

        tIn.forceApprove(s.router, 0);
        received = tOut.balanceOf(address(this)) - outBefore;
        if (received == 0) revert ZeroOutput();
    }

    /*//////////////////////////////////////////////////////////////
                         POLICY INTERNALS
    //////////////////////////////////////////////////////////////*/

    function _validateMandate(Mandate memory m) internal pure {
        if (m.maxDrawdownBps == 0 || m.maxDrawdownBps > MAX_DRAWDOWN_LIMIT_BPS) revert BadMandate();
        if (m.maxSlippageBps > MAX_SLIPPAGE_LIMIT_BPS) revert BadMandate();
        if (m.maxPositionSize == 0 || m.maxDailyVolume == 0) revert BadMandate();
    }

    function _validatePolicy(PolicyChange calldata c) internal view {
        _validateMandate(c.mandate);
        for (uint256 i; i < c.addTokens.length; ++i) {
            if (c.addTokens[i] == address(0)) revert ZeroAddress();
        }
        for (uint256 i; i < c.addRouters.length; ++i) {
            if (c.addRouters[i] == address(0)) revert ZeroAddress();
        }
        for (uint256 i; i < c.removeTokens.length; ++i) {
            if (c.removeTokens[i] == address(baseAsset)) revert BaseAssetProtected();
        }
    }

    function _applyPolicy(PolicyChange calldata c) internal {
        mandate = c.mandate;

        for (uint256 i; i < c.addTokens.length; ++i) {
            isTokenAllowed[c.addTokens[i]] = true;
        }
        for (uint256 i; i < c.removeTokens.length; ++i) {
            isTokenAllowed[c.removeTokens[i]] = false;
        }
        for (uint256 i; i < c.addRouters.length; ++i) {
            isRouterAllowed[c.addRouters[i]] = true;
        }
        for (uint256 i; i < c.removeRouters.length; ++i) {
            isRouterAllowed[c.removeRouters[i]] = false;
        }

        if (c.newAgent != address(0) && c.newAgent != agent) {
            emit AgentChanged(agent, c.newAgent);
            agent = c.newAgent;
        }
    }

    /*//////////////////////////////////////////////////////////////
                    VIEWS FOR THE DASHBOARD AND CHAT
    //////////////////////////////////////////////////////////////*/

    /// @notice Current value in base units.
    function balance() public view returns (uint256) {
        return baseAsset.balanceOf(address(this));
    }

    /// @notice Value below which the vault freezes the agent.
    function lossFloor() public view returns (uint256) {
        return (highWaterMark * (BPS - mandate.maxDrawdownBps)) / BPS;
    }

    /// @notice How far below the peak the vault is now, in basis points.
    function currentDrawdownBps() external view returns (uint256) {
        uint256 bal = balance();
        if (highWaterMark == 0 || bal >= highWaterMark) return 0;
        return ((highWaterMark - bal) * BPS) / highWaterMark;
    }

    /// @notice Base units the agent can still trade today.
    function volumeRemainingToday() external view returns (uint256) {
        if (uint64(block.timestamp / 1 days) != volumeDay) return mandate.maxDailyVolume;
        return volumeToday >= mandate.maxDailyVolume ? 0 : mandate.maxDailyVolume - volumeToday;
    }

    /// @notice True if a trade of this size needs an owner approval.
    function requiresApproval(uint256 amountIn) public view returns (bool) {
        return amountIn > mandate.approvalThreshold;
    }

    /// @notice Hash of a route. The approval signature covers this.
    function hashCycle(Step[] calldata steps) public pure returns (bytes32) {
        return keccak256(abi.encode(steps));
    }

    /// @notice The exact EIP-712 digest the owner must sign to approve one trade.
    function approvalDigest(bytes32 cycleHash, uint256 amountIn, uint256 minReturn, uint64 expiry, uint256 nonce)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(TRADE_APPROVAL_TYPEHASH, cycleHash, amountIn, minReturn, expiry, nonce))
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
