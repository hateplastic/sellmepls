// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract PaymentRouter is ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    struct Quote {
        bytes32 orderId;
        address buyer;
        address seller;
        address token;
        uint256 amount;
        uint256 fee;
        address affiliate;
        uint256 affiliateAmount;
        uint256 deadline;
    }
    bytes32 private constant QUOTE_TYPEHASH = keccak256("Quote(bytes32 orderId,address buyer,address seller,address token,uint256 amount,uint256 fee,address affiliate,uint256 affiliateAmount,uint256 deadline)");
    address public immutable platform;
    address public immutable quoteSigner;
    mapping(bytes32 => bool) public paid;
    mapping(address => bool) public allowedToken;
    event Paid(bytes32 indexed orderId, address indexed buyer, address indexed seller, address token, uint256 amount, uint256 fee, address affiliate, uint256 affiliateAmount);
    error InvalidPayment();
    error TransferFailed();
    constructor(address platform_, address signer_, address[] memory tokens) EIP712("Sellmepls", "2") {
        if (platform_ == address(0) || signer_ == address(0)) revert InvalidPayment();
        platform = platform_;
        quoteSigner = signer_;
        for (uint256 i; i < tokens.length; ++i) {
            if (tokens[i].code.length == 0) revert InvalidPayment();
            allowedToken[tokens[i]] = true;
        }
    }
    function pay(Quote calldata q, bytes calldata signature) external payable nonReentrant {
        bytes32 key = keccak256(abi.encode(msg.sender, q.orderId));
        if (q.buyer != msg.sender || q.orderId == bytes32(0) || paid[key] || block.timestamp > q.deadline || q.amount < 100 || q.amount > 1e35 || q.fee <= q.amount * 500 / 10000 || q.fee + q.affiliateAmount >= q.amount) revert InvalidPayment();
        if (q.seller == address(0) || q.seller == address(this) || q.seller == msg.sender || q.seller == platform || msg.sender == platform) revert InvalidPayment();
        if ((q.affiliateAmount == 0) != (q.affiliate == address(0))) revert InvalidPayment();
        if (q.affiliateAmount > 0 && (q.affiliate == q.seller || q.affiliate == platform || q.affiliate == msg.sender || q.affiliate == address(this))) revert InvalidPayment();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(QUOTE_TYPEHASH, q)));
        if (ECDSA.recover(digest, signature) != quoteSigner) revert InvalidPayment();
        paid[key] = true;
        if (q.token == address(0)) {
            if (msg.value != q.amount) revert InvalidPayment();
            _sendNative(q.seller, q.amount - q.fee - q.affiliateAmount);
            _sendNative(platform, q.fee);
            if (q.affiliateAmount > 0) _sendNative(q.affiliate, q.affiliateAmount);
        } else {
            if (msg.value != 0 || !allowedToken[q.token]) revert InvalidPayment();
            IERC20 coin = IERC20(q.token);
            _sendToken(coin, q.seller, q.amount - q.fee - q.affiliateAmount);
            _sendToken(coin, platform, q.fee);
            if (q.affiliateAmount > 0) _sendToken(coin, q.affiliate, q.affiliateAmount);
        }
        emit Paid(q.orderId, msg.sender, q.seller, q.token, q.amount, q.fee, q.affiliate, q.affiliateAmount);
    }
    function _sendNative(address to, uint256 amount) private {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
    function _sendToken(IERC20 coin, address to, uint256 amount) private {
        uint256 beforeBalance = coin.balanceOf(to);
        coin.safeTransferFrom(msg.sender, to, amount);
        if (coin.balanceOf(to) - beforeBalance != amount) revert TransferFailed();
    }
}
