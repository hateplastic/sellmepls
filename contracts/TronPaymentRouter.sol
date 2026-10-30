// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

interface ITronToken {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract TronPaymentRouter {
    struct Quote { bytes32 orderId; address buyer; address seller; address token; uint256 amount; uint256 fee; address affiliate; uint256 affiliateAmount; uint256 deadline; }
    bytes32 private constant TYPEHASH = keccak256("Quote(bytes32 orderId,address buyer,address seller,address token,uint256 amount,uint256 fee,address affiliate,uint256 affiliateAmount,uint256 deadline)");
    address public immutable platform;
    address public immutable quoteSigner;
    mapping(address => bool) public allowedToken;
    mapping(bytes32 => bool) public paid;
    bool private entered;
    event Paid(bytes32 indexed orderId,address indexed buyer,address indexed seller,address token,uint256 amount,uint256 fee,address affiliate,uint256 affiliateAmount);
    error InvalidPayment();
    error TransferFailed();
    constructor(address platform_,address signer_,address[] memory tokens) {
        if(platform_==address(0) || signer_==address(0)) revert InvalidPayment();
        platform=platform_; quoteSigner=signer_;
        for(uint256 i; i<tokens.length; ++i) { if(tokens[i].code.length==0) revert InvalidPayment(); allowedToken[tokens[i]]=true; }
    }
    function pay(Quote calldata q,bytes calldata signature) external {
        bytes32 key=keccak256(abi.encode(msg.sender,q.orderId));
        if(entered || q.buyer!=msg.sender || q.orderId==bytes32(0) || paid[key] || block.timestamp>q.deadline || q.amount<100 || q.amount>1e35 || q.fee<=q.amount*500/10000 || q.fee+q.affiliateAmount>=q.amount || !allowedToken[q.token]) revert InvalidPayment();
        if(q.seller==address(0) || q.seller==address(this) || q.seller==msg.sender || q.seller==platform || msg.sender==platform) revert InvalidPayment();
        if((q.affiliateAmount==0)!=(q.affiliate==address(0))) revert InvalidPayment();
        if(q.affiliateAmount>0 && (q.affiliate==q.seller || q.affiliate==platform || q.affiliate==msg.sender || q.affiliate==address(this))) revert InvalidPayment();
        {
        bytes32 domain=keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),keccak256("Sellmepls"),keccak256("2"),block.chainid,address(this)));
        bytes32 digest=keccak256(abi.encodePacked(hex"1901",domain,keccak256(abi.encode(TYPEHASH,q))));
        if(signature.length!=65) revert InvalidPayment();
        bytes32 r; bytes32 s; uint8 v;
        assembly { r := calldataload(signature.offset) s := calldataload(add(signature.offset,32)) v := byte(0,calldataload(add(signature.offset,64))) }
        if(uint256(s)>0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0 || (v!=27 && v!=28) || ecrecover(digest,v,r,s)!=quoteSigner) revert InvalidPayment();
        }
        entered=true; paid[key]=true;
        _transfer(q.token,q.seller,q.amount-q.fee-q.affiliateAmount);
        _transfer(q.token,platform,q.fee);
        if(q.affiliateAmount>0) _transfer(q.token,q.affiliate,q.affiliateAmount);
        emit Paid(q.orderId,msg.sender,q.seller,q.token,q.amount,q.fee,q.affiliate,q.affiliateAmount);
        entered=false;
    }
    function _transfer(address token,address to,uint256 amount) private {
        uint256 beforeBalance=ITronToken(token).balanceOf(to);
        (bool ok,bytes memory result)=token.call(abi.encodeCall(ITronToken.transferFrom,(msg.sender,to,amount)));
        if(!ok || (result.length!=0 && (result.length!=32 || !abi.decode(result,(bool)))) || ITronToken(token).balanceOf(to)-beforeBalance!=amount) revert TransferFailed();
    }
}
