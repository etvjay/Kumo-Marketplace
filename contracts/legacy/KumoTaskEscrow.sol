// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// LEGACY PORT: exact economic role from Jaydearcadian/Kumo baseline 0dd10a0.
// This contract is not ERC-8183 and is not the canonical BNB hiring primitive.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract KumoTaskEscrow {
    enum Status { None, Funded, Locked, Released, Refunded, Disputed }
    struct Escrow { address requester; address agent; address token; uint256 amount; Status status; }
    address public immutable arbiter;
    mapping(bytes32 => Escrow) public escrows;

    event TaskEscrowFunded(bytes32 indexed taskKey, address indexed requester, address indexed agent, address token, uint256 amount);
    event TaskEscrowLocked(bytes32 indexed taskKey, address indexed requester, address indexed agent);
    event TaskEscrowReleased(bytes32 indexed taskKey, address indexed agent, uint256 amount);
    event TaskEscrowRefunded(bytes32 indexed taskKey, address indexed requester, uint256 amount);
    event TaskEscrowDisputed(bytes32 indexed taskKey, address indexed requester, address indexed agent);

    error Unauthorized(); error InvalidEscrow(); error InvalidState();

    constructor(address arbiter_) { arbiter = arbiter_ == address(0) ? msg.sender : arbiter_; }

    function fundTask(bytes32 taskKey, address agent, address token, uint256 amount) external {
        if (taskKey == bytes32(0) || agent == address(0) || token == address(0) || amount == 0) revert InvalidEscrow();
        if (escrows[taskKey].status != Status.None) revert InvalidState();
        bool ok = IERC20(token).transferFrom(msg.sender, address(this), amount);
        if (!ok) revert InvalidEscrow();
        escrows[taskKey] = Escrow(msg.sender, agent, token, amount, Status.Funded);
        emit TaskEscrowFunded(taskKey, msg.sender, agent, token, amount);
    }

    function lockTask(bytes32 taskKey) external {
        Escrow storage escrow = escrows[taskKey];
        if (escrow.status != Status.Funded) revert InvalidState();
        if (msg.sender != escrow.requester && msg.sender != arbiter) revert Unauthorized();
        escrow.status = Status.Locked;
        emit TaskEscrowLocked(taskKey, escrow.requester, escrow.agent);
    }

    function release(bytes32 taskKey) external {
        Escrow storage escrow = escrows[taskKey];
        if (escrow.status == Status.Locked) {
            if (msg.sender != escrow.requester && msg.sender != arbiter) revert Unauthorized();
        } else if (escrow.status == Status.Disputed) {
            if (msg.sender != arbiter) revert Unauthorized();
        } else revert InvalidState();
        escrow.status = Status.Released;
        bool ok = IERC20(escrow.token).transfer(escrow.agent, escrow.amount);
        if (!ok) revert InvalidEscrow();
        emit TaskEscrowReleased(taskKey, escrow.agent, escrow.amount);
    }

    function refund(bytes32 taskKey) external {
        Escrow storage escrow = escrows[taskKey];
        if (escrow.status == Status.Funded) {
            if (msg.sender != escrow.requester && msg.sender != arbiter) revert Unauthorized();
        } else if (escrow.status == Status.Disputed) {
            if (msg.sender != arbiter) revert Unauthorized();
        } else revert InvalidState();
        escrow.status = Status.Refunded;
        bool ok = IERC20(escrow.token).transfer(escrow.requester, escrow.amount);
        if (!ok) revert InvalidEscrow();
        emit TaskEscrowRefunded(taskKey, escrow.requester, escrow.amount);
    }

    function markDisputed(bytes32 taskKey) external {
        Escrow storage escrow = escrows[taskKey];
        if (escrow.status != Status.Locked) revert InvalidState();
        if (msg.sender != escrow.requester && msg.sender != escrow.agent && msg.sender != arbiter) revert Unauthorized();
        escrow.status = Status.Disputed;
        emit TaskEscrowDisputed(taskKey, escrow.requester, escrow.agent);
    }
}
