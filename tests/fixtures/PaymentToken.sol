// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract PaymentToken is ERC20 {
    address public blocked;
    constructor() ERC20("Local test token", "TEST") { _mint(msg.sender, 1000000000); }
    function setBlocked(address account) external { blocked = account; }
    function _update(address from, address to, uint256 value) internal override {
        require(to != blocked, "recipient blocked");
        super._update(from, to, value);
    }
}
