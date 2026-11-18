// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

enum GraduationPhase {
    NotGraduated,
    Swept,
    PoolCreated,
    Rescued
}

interface IPonsV2LaunchFactory {
    struct LaunchedToken {
        address token;
        address curve;
        address deployer;
        address creatorFeeRecipient;
        address pairToken;
        uint256 graduationThreshold;
        uint24 poolFee;
        int24 tickSpacing;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        GraduationPhase phase;
        uint256 sweptQuote;
        uint256 sweptTokens;
        uint256 sweptAt;
        bool exists;
    }

    function getLaunchedToken(address token) external view returns (LaunchedToken memory);
}

interface IPonsV2BondingCurve {
    function graduated() external view returns (bool);
    function readyToGraduate() external view returns (bool);
    function realQuoteReserve() external view returns (uint256);
    function graduationThreshold() external view returns (uint256);
    function creatorTaxBps() external view returns (uint16);
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256 tokensOut);
    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) external returns (uint256 quoteOut);
}

interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @title HARDWIRE Direct Execution & AI Agent Router (Robinhood Chain 4663)
/// @notice Non-custodial direct router for AI agents, MCP clients, and curve traders on Robinhood Chain.
///         - Routes buys and sells directly into Pons v2 bonding curves AND auto-switches to Uniswap v4
///           pools the block a token graduates.
///         - Enforces `maxCreatorTaxBps` on-chain so agents never get trapped by predatory creator taxes.
///         - Charges 0% router fee for wallets holding >= 500,000 $HWIRE (saving 1.00% per leg / 2.00%
///           round-trip vs standard third-party bot routers).
///         - Charges 0.30% for non-holders, routing 100% of collected ETH into an immutable burnBucket
///           with zero admin withdrawal: anyone can call `ignite()` (earning a 1% gas tip) to buy $HWIRE
///           straight to `0x000000000000000000000000000000000000dEaD`.
contract HardwireRouter {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct ExactInputSingleParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    IPonsV2LaunchFactory public constant FACTORY = IPonsV2LaunchFactory(0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e);
    IUniversalRouter public constant ROUTER = IUniversalRouter(0x8876789976dEcBfCbBbe364623C63652db8C0904);
    IPermit2 public constant PERMIT2 = IPermit2(0x000000000022D473030F116dDEE9F6B43aC78BA3);
    address public constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;

    uint256 public constant BPS = 10_000;
    uint256 public constant BOT_BENCHMARK_FEE_BPS = 100; // 1.00% charged by standard RH bot routers
    uint256 public constant NON_HOLDER_FEE_BPS = 30;     // 0.30% for non-holders (100% burned via ignite)
    uint256 public constant IGNITE_TIP_BPS = 100;        // 1.00% gas tip to permissionless ignite() caller
    uint256 public constant MIN_IGNITE = 0.0002 ether;
    uint256 public constant MAX_IGNITE = 0.5 ether;

    uint256 public constant HOLDER_MIN = 500_000 ether;  // 500K $HWIRE -> 0% router fee + swarm/basket unlock
    uint256 public constant PRIORITY_BURN = 25_000 ether;// 25K $HWIRE burned -> 1 priority deep-audit credit

    address public immutable deployer;

    // Bound once via bindHardwire() immediately after $HWIRE launches on Pons; immutable thereafter.
    IERC20 public hardwire;
    IPonsV2BondingCurve public hardwireCurve;
    uint24 public hardwirePoolFee;
    int24 public hardwireTickSpacing;

    // Protocol telemetry & autonomous buyback-and-burn accumulator
    uint256 public burnBucket;
    uint256 public totalTrades;
    uint256 public totalVolumeWei;
    uint256 public totalSavedVsBotRoutersWei;
    uint256 public totalBurnEthSpent;
    uint256 public totalHardwireBurned;
    uint256 public burnCount;

    mapping(address => uint256) public userVolumeWei;
    mapping(address => uint256) public userSavedWei;
    mapping(address => uint256) public priorityCredits;

    uint256 private _locked = 1;

    error OnlyDeployer();
    error AlreadyBound();
    error HardwireNotBound();
    error UnknownPonsToken();
    error UnsupportedPairToken();
    error CreatorTaxTooHigh(uint16 actualBps, uint16 maxAllowedBps);
    error ZeroAmount();
    error InvalidArrayLengths();
    error BatchSizeOutOfBounds();
    error HolderTierRequired();
    error SlippageExceeded(uint256 actualOut, uint256 minRequired);
    error NothingToIgnite();
    error NothingBought();
    error TransferFailed();
    error Reentrancy();

    event HardwireBound(address indexed token, address indexed curve, uint24 poolFee, int24 tickSpacing);
    event DirectTrade(
        address indexed trader,
        address indexed recipient,
        address indexed token,
        bool isBuy,
        uint256 ethAmount,
        uint256 tokenAmount,
        uint256 feeWei,
        uint256 savedVsBotWei,
        bool routedViaV4,
        bytes32 agentIntentHash
    );
    event SwarmExecuted(
        address indexed trader,
        address indexed token,
        uint256 walletCount,
        uint256 totalEthSpent,
        uint256 totalTokensOut,
        bytes32 agentIntentHash
    );
    event PriorityBurned(address indexed user, uint256 amountBurned, uint256 totalCredits, bytes32 promptHash);
    event Ignited(
        address indexed caller,
        uint256 ethSpent,
        uint256 callerTipWei,
        uint256 hardwireBurned,
        bool boughtOnCurve,
        uint256 burnIndex
    );

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor() {
        deployer = msg.sender;
    }

    receive() external payable {}

    /// @notice One-time binding to the live $HWIRE Pons v2 token. Locks permanently on first call.
    function bindHardwire(address token_) external {
        if (msg.sender != deployer) revert OnlyDeployer();
        if (address(hardwire) != address(0)) revert AlreadyBound();

        IPonsV2LaunchFactory.LaunchedToken memory info = FACTORY.getLaunchedToken(token_);
        if (!info.exists || info.pairToken != address(0)) revert UnknownPonsToken();

        hardwire = IERC20(token_);
        hardwireCurve = IPonsV2BondingCurve(info.curve);
        hardwirePoolFee = info.poolFee;
        hardwireTickSpacing = info.tickSpacing;

        emit HardwireBound(token_, info.curve, info.poolFee, info.tickSpacing);
    }

    /// @notice Returns true when `user` qualifies for 0% router fees and swarm execution.
    function isZeroFeeHolder(address user) public view returns (bool) {
        if (address(hardwire) == address(0)) return true;
        return hardwire.balanceOf(user) >= HOLDER_MIN;
    }

    /// @notice Returns active router fee in bps for `user` (0 bps for >=500K $HWIRE holders, else 30 bps).
    function feeBpsFor(address user) public view returns (uint256) {
        return isZeroFeeHolder(user) ? 0 : NON_HOLDER_FEE_BPS;
    }

    // ─── Direct Buy & Sell (Auto Curve / Uniswap v4 Venue Switch) ────────────────

    /// @notice Buys `token` with native ETH directly on its Pons curve (or Uniswap v4 pool if graduated),
    ///         enforcing `maxCreatorTaxBps` and `minTokensOut`. Refunds any graduation cap dust automatically.
    function directBuy(
        address token,
        uint256 minTokensOut,
        uint16 maxCreatorTaxBps,
        address recipient,
        bytes32 agentIntentHash
    ) external payable nonReentrant returns (uint256 tokensOut) {
        if (msg.value == 0) revert ZeroAmount();
        address outRecipient = recipient == address(0) ? msg.sender : recipient;

        IPonsV2LaunchFactory.LaunchedToken memory info = _requireEthPonsToken(token, maxCreatorTaxBps);
        uint256 fBps = feeBpsFor(msg.sender);
        uint256 maxFee = (msg.value * fBps) / BPS;
        uint256 swapBudget = msg.value - maxFee;

        bool useV4 = _isGraduated(info);
        uint256 actualSwapEth;

        if (!useV4) {
            uint256 ethBefore = address(this).balance;
            uint256 tokBefore = IERC20(token).balanceOf(outRecipient);
            IPonsV2BondingCurve(info.curve).buy{value: swapBudget}(swapBudget, minTokensOut, outRecipient);
            tokensOut = IERC20(token).balanceOf(outRecipient) - tokBefore;
            actualSwapEth = ethBefore - address(this).balance;
        } else {
            tokensOut = _buyInV4Pool(info, swapBudget, minTokensOut, outRecipient);
            actualSwapEth = swapBudget;
        }

        if (tokensOut < minTokensOut) revert SlippageExceeded(tokensOut, minTokensOut);

        // If curve capped swapEth at the 4.20 ETH graduation boundary, charge fee only on used ETH and refund the rest
        uint256 actualFee = actualSwapEth == swapBudget
            ? maxFee
            : (actualSwapEth * fBps) / (BPS - fBps);
        if (actualFee > maxFee) actualFee = maxFee;

        if (actualFee > 0) {
            burnBucket += actualFee;
        }

        uint256 totalUsed = actualSwapEth + actualFee;
        if (msg.value > totalUsed) {
            _sendEth(msg.sender, msg.value - totalUsed);
        }

        uint256 savedWei = _recordStats(msg.sender, actualSwapEth, actualFee);
        emit DirectTrade(
            msg.sender,
            outRecipient,
            token,
            true,
            actualSwapEth,
            tokensOut,
            actualFee,
            savedWei,
            useV4,
            agentIntentHash
        );
    }

    /// @notice Sells `tokensIn` of `token` for native ETH directly into its Pons curve (or Uniswap v4 pool
    ///         if graduated), enforcing `maxCreatorTaxBps` and `minEthOut`.
    function directSell(
        address token,
        uint256 tokensIn,
        uint256 minEthOut,
        uint16 maxCreatorTaxBps,
        address recipient,
        bytes32 agentIntentHash
    ) external nonReentrant returns (uint256 netEthOut) {
        if (tokensIn == 0) revert ZeroAmount();
        address outRecipient = recipient == address(0) ? msg.sender : recipient;

        IPonsV2LaunchFactory.LaunchedToken memory info = _requireEthPonsToken(token, maxCreatorTaxBps);

        bool pulled = IERC20(token).transferFrom(msg.sender, address(this), tokensIn);
        if (!pulled) revert TransferFailed();

        bool useV4 = _isGraduated(info);
        uint256 grossEthOut;

        if (!useV4) {
            _ensureAllowance(IERC20(token), info.curve, tokensIn);
            uint256 ethBefore = address(this).balance;
            IPonsV2BondingCurve(info.curve).sell(tokensIn, 0, address(this));
            grossEthOut = address(this).balance - ethBefore;
        } else {
            grossEthOut = _sellInV4Pool(info, tokensIn);
        }

        uint256 fBps = feeBpsFor(msg.sender);
        uint256 feeWei = (grossEthOut * fBps) / BPS;
        if (feeWei > 0) {
            burnBucket += feeWei;
        }

        netEthOut = grossEthOut - feeWei;
        if (netEthOut < minEthOut) revert SlippageExceeded(netEthOut, minEthOut);

        _sendEth(outRecipient, netEthOut);
        uint256 savedWei = _recordStats(msg.sender, grossEthOut, feeWei);

        emit DirectTrade(
            msg.sender,
            outRecipient,
            token,
            false,
            netEthOut,
            tokensIn,
            feeWei,
            savedWei,
            useV4,
            agentIntentHash
        );
    }

    // ─── Holder-Gated Multi-Wallet Swarm & AI Basket Execution (0% Fee) ──────────

    /// @notice Splits one ETH buy across 2..8 recipient wallets in the exact same block at 0% router fee.
    ///         Unlocked by holding >= 500,000 $HWIRE.
    function swarmBuy(
        address token,
        address[] calldata recipients,
        uint256[] calldata ethShares,
        uint256[] calldata minOuts,
        uint16 maxCreatorTaxBps,
        bytes32 agentIntentHash
    ) external payable nonReentrant returns (uint256 totalTokensOut) {
        if (!isZeroFeeHolder(msg.sender)) revert HolderTierRequired();
        uint256 n = recipients.length;
        if (n < 2 || n > 8) revert BatchSizeOutOfBounds();
        if (ethShares.length != n || minOuts.length != n) revert InvalidArrayLengths();

        IPonsV2LaunchFactory.LaunchedToken memory info = _requireEthPonsToken(token, maxCreatorTaxBps);
        bool useV4 = _isGraduated(info);

        uint256 sumBudget;
        uint256 totalActualEth;

        for (uint256 i = 0; i < n; ++i) {
            uint256 legEth = ethShares[i];
            if (legEth == 0) revert ZeroAmount();
            sumBudget += legEth;
            address to = recipients[i] == address(0) ? msg.sender : recipients[i];

            uint256 legOut;
            uint256 legSpent;
            if (!useV4 && !IPonsV2BondingCurve(info.curve).graduated()) {
                uint256 ethBefore = address(this).balance;
                uint256 tokBefore = IERC20(token).balanceOf(to);
                IPonsV2BondingCurve(info.curve).buy{value: legEth}(legEth, minOuts[i], to);
                legOut = IERC20(token).balanceOf(to) - tokBefore;
                legSpent = ethBefore - address(this).balance;
            } else {
                useV4 = true;
                legOut = _buyInV4Pool(info, legEth, minOuts[i], to);
                legSpent = legEth;
            }

            if (legOut < minOuts[i]) revert SlippageExceeded(legOut, minOuts[i]);
            totalTokensOut += legOut;
            totalActualEth += legSpent;
        }

        if (sumBudget > msg.value) revert ZeroAmount();
        if (msg.value > totalActualEth) {
            _sendEth(msg.sender, msg.value - totalActualEth);
        }

        _recordStats(msg.sender, totalActualEth, 0);
        emit SwarmExecuted(msg.sender, token, n, totalActualEth, totalTokensOut, agentIntentHash);
    }

    /// @notice Executes an AI-curated multi-token basket buy (2..6 Pons tokens) in one signature at 0% fee for holders.
    function basketBuy(
        address[] calldata tokens,
        uint256[] calldata ethAmounts,
        uint256[] calldata minOuts,
        uint16 maxCreatorTaxBps,
        bytes32 agentIntentHash
    ) external payable nonReentrant returns (uint256 totalEthUsed) {
        if (!isZeroFeeHolder(msg.sender)) revert HolderTierRequired();
        uint256 n = tokens.length;
        if (n < 2 || n > 6) revert BatchSizeOutOfBounds();
        if (ethAmounts.length != n || minOuts.length != n) revert InvalidArrayLengths();

        uint256 sumBudget;
        for (uint256 i = 0; i < n; ++i) {
            uint256 legEth = ethAmounts[i];
            if (legEth == 0) revert ZeroAmount();
            sumBudget += legEth;

            IPonsV2LaunchFactory.LaunchedToken memory info = _requireEthPonsToken(tokens[i], maxCreatorTaxBps);
            bool useV4 = _isGraduated(info);
            uint256 legOut;
            uint256 legSpent;

            if (!useV4) {
                uint256 ethBefore = address(this).balance;
                uint256 tokBefore = IERC20(tokens[i]).balanceOf(msg.sender);
                IPonsV2BondingCurve(info.curve).buy{value: legEth}(legEth, minOuts[i], msg.sender);
                legOut = IERC20(tokens[i]).balanceOf(msg.sender) - tokBefore;
                legSpent = ethBefore - address(this).balance;
            } else {
                legOut = _buyInV4Pool(info, legEth, minOuts[i], msg.sender);
                legSpent = legEth;
            }

            if (legOut < minOuts[i]) revert SlippageExceeded(legOut, minOuts[i]);
            totalEthUsed += legSpent;
            uint256 savedWei = _recordStats(msg.sender, legSpent, 0);
            emit DirectTrade(msg.sender, msg.sender, tokens[i], true, legSpent, legOut, 0, savedWei, useV4, agentIntentHash);
        }

        if (sumBudget > msg.value) revert ZeroAmount();
        if (msg.value > totalEthUsed) {
            _sendEth(msg.sender, msg.value - totalEthUsed);
        }
    }

    // ─── Burn-to-Audit Priority & Autonomous $HWIRE Buyback Furnace ──────────────

    /// @notice Burns 25,000 $HWIRE straight to 0x...dEaD to unlock a verifiable priority deep-audit credit.
    function burnForPriority(bytes32 promptHash) external nonReentrant returns (uint256 credits) {
        if (address(hardwire) == address(0)) revert HardwireNotBound();
        bool ok = hardwire.transferFrom(msg.sender, DEAD, PRIORITY_BURN);
        if (!ok) revert TransferFailed();

        credits = ++priorityCredits[msg.sender];
        totalHardwireBurned += PRIORITY_BURN;
        emit PriorityBurned(msg.sender, PRIORITY_BURN, credits, promptHash);
    }

    /// @notice Permissionless buyback-and-burn: spends accumulated `burnBucket` ETH to buy $HWIRE
    ///         on Pons curve / Uniswap v4 pool straight to 0x...dEaD and tips caller 1% in ETH.
    function ignite() external nonReentrant returns (uint256 hwireBurned) {
        return _igniteInternal(true);
    }

    /// @notice Adds attached ETH directly to `burnBucket` and triggers an immediate buyback-and-burn to 0x...dEaD.
    function donateAndIgnite() external payable nonReentrant returns (uint256 hwireBurned) {
        if (msg.value == 0) revert ZeroAmount();
        burnBucket += msg.value;
        return _igniteInternal(false);
    }

    // ─── Views ───────────────────────────────────────────────────────────────────

    function routerStats()
        external
        view
        returns (
            bool bound,
            address hardwireToken,
            address hardwireCurveAddr,
            uint256 trades,
            uint256 volumeWei,
            uint256 savedVsBotsWei,
            uint256 pendingBurnWei,
            uint256 burnedEthWei,
            uint256 burnedHardwire,
            uint256 ignitions
        )
    {
        return (
            address(hardwire) != address(0),
            address(hardwire),
            address(hardwireCurve),
            totalTrades,
            totalVolumeWei,
            totalSavedVsBotRoutersWei,
            burnBucket,
            totalBurnEthSpent,
            totalHardwireBurned,
            burnCount
        );
    }

    function inspectPonsToken(address token)
        external
        view
        returns (
            bool exists,
            address curve,
            uint16 creatorTaxBps,
            bool graduated,
            uint256 realQuoteReserve,
            uint256 graduationThreshold
        )
    {
        IPonsV2LaunchFactory.LaunchedToken memory info = FACTORY.getLaunchedToken(token);
        if (!info.exists) return (false, address(0), 0, false, 0, 0);
        IPonsV2BondingCurve c = IPonsV2BondingCurve(info.curve);
        bool grad = c.graduated() || info.phase != GraduationPhase.NotGraduated;
        return (
            true,
            info.curve,
            info.creatorTaxBps,
            grad,
            c.realQuoteReserve(),
            info.graduationThreshold
        );
    }

    // ─── Internals ───────────────────────────────────────────────────────────────

    function _igniteInternal(bool payCallerTip) private returns (uint256 hwireBurned) {
        if (address(hardwire) == address(0)) revert HardwireNotBound();
        uint256 available = burnBucket;
        if (available < MIN_IGNITE) revert NothingToIgnite();

        uint256 chunk = available > MAX_IGNITE ? MAX_IGNITE : available;
        uint256 tip = payCallerTip ? (chunk * IGNITE_TIP_BPS) / BPS : 0;
        uint256 maxSpend = chunk - tip;

        burnBucket = available - chunk;

        uint256 ethBefore = address(this).balance;
        uint256 deadBefore = hardwire.balanceOf(DEAD);
        bool boughtOnCurve = true;

        if (!hardwireCurve.graduated() && !hardwireCurve.readyToGraduate()) {
            try hardwireCurve.buy{value: maxSpend}(maxSpend, 0, DEAD) {} catch {
                boughtOnCurve = false;
            }
        } else {
            boughtOnCurve = false;
        }

        if (!boughtOnCurve) {
            IPonsV2LaunchFactory.LaunchedToken memory hwInfo = FACTORY.getLaunchedToken(address(hardwire));
            _buyInV4Pool(hwInfo, maxSpend, 0, DEAD);
        }

        hwireBurned = hardwire.balanceOf(DEAD) - deadBefore;
        if (hwireBurned == 0) revert NothingBought();

        uint256 actualSpent = ethBefore - address(this).balance;
        if (maxSpend > actualSpent) {
            burnBucket += (maxSpend - actualSpent);
        }

        totalBurnEthSpent += actualSpent;
        totalHardwireBurned += hwireBurned;
        unchecked {
            ++burnCount;
        }

        if (tip > 0) {
            _sendEth(msg.sender, tip);
        }

        emit Ignited(msg.sender, actualSpent, tip, hwireBurned, boughtOnCurve, burnCount);
    }

    function _requireEthPonsToken(address token, uint16 maxCreatorTaxBps)
        private
        view
        returns (IPonsV2LaunchFactory.LaunchedToken memory info)
    {
        info = FACTORY.getLaunchedToken(token);
        if (!info.exists) revert UnknownPonsToken();
        if (info.pairToken != address(0)) revert UnsupportedPairToken();
        if (info.creatorTaxBps > maxCreatorTaxBps) {
            revert CreatorTaxTooHigh(info.creatorTaxBps, maxCreatorTaxBps);
        }
    }

    function _isGraduated(IPonsV2LaunchFactory.LaunchedToken memory info) private view returns (bool) {
        if (info.phase != GraduationPhase.NotGraduated) return true;
        return IPonsV2BondingCurve(info.curve).graduated();
    }

    function _buyInV4Pool(
        IPonsV2LaunchFactory.LaunchedToken memory info,
        uint256 ethIn,
        uint256 minOut,
        address outRecipient
    ) private returns (uint256 tokensOut) {
        uint256 balBefore = IERC20(info.token).balanceOf(address(this));

        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            ExactInputSingleParams({
                poolKey: PoolKey(address(0), info.token, info.poolFee, info.tickSpacing, PONS_HOOK),
                zeroForOne: true,
                amountIn: uint128(ethIn),
                amountOutMinimum: uint128(minOut),
                hookData: ""
            })
        );
        params[1] = abi.encode(address(0), ethIn);
        params[2] = abi.encode(info.token, minOut);

        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"060c0f", params);
        ROUTER.execute{value: ethIn}(hex"10", inputs, block.timestamp);

        tokensOut = IERC20(info.token).balanceOf(address(this)) - balBefore;
        if (tokensOut > 0 && outRecipient != address(this)) {
            bool ok = IERC20(info.token).transfer(outRecipient, tokensOut);
            if (!ok) revert TransferFailed();
        }
    }

    function _sellInV4Pool(IPonsV2LaunchFactory.LaunchedToken memory info, uint256 tokensIn)
        private
        returns (uint256 ethOut)
    {
        _ensureAllowance(IERC20(info.token), address(PERMIT2), tokensIn);
        PERMIT2.approve(info.token, address(ROUTER), uint160(tokensIn), uint48(block.timestamp + 60));

        uint256 ethBefore = address(this).balance;

        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            ExactInputSingleParams({
                poolKey: PoolKey(address(0), info.token, info.poolFee, info.tickSpacing, PONS_HOOK),
                zeroForOne: false,
                amountIn: uint128(tokensIn),
                amountOutMinimum: 0,
                hookData: ""
            })
        );
        params[1] = abi.encode(info.token, tokensIn);
        params[2] = abi.encode(address(0), uint256(0));

        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"060c0f", params);
        ROUTER.execute(hex"10", inputs, block.timestamp);

        ethOut = address(this).balance - ethBefore;
    }

    function _ensureAllowance(IERC20 tok, address spender, uint256 needed) private {
        if (tok.allowance(address(this), spender) < needed) {
            tok.approve(spender, type(uint256).max);
        }
    }

    function _recordStats(address trader, uint256 ethVol, uint256 feeCharged) private returns (uint256 savedWei) {
        uint256 benchmarkBotFee = (ethVol * BOT_BENCHMARK_FEE_BPS) / BPS;
        savedWei = benchmarkBotFee > feeCharged ? benchmarkBotFee - feeCharged : 0;

        unchecked {
            ++totalTrades;
            totalVolumeWei += ethVol;
            totalSavedVsBotRoutersWei += savedWei;
            userVolumeWei[trader] += ethVol;
            userSavedWei[trader] += savedWei;
        }
    }

    function _sendEth(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
