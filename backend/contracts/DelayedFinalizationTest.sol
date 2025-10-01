// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {DelayedFinalization} from "./DelayedFinalization.sol";

contract DelayedFinalizationTest {
    using DelayedFinalization for mapping(bytes32 => DelayedFinalization.ValueStatus);

    // Storage mapping for testing values
    mapping(bytes32 => DelayedFinalization.ValueStatus) public testValues;

    // Event to track value updates for easier testing
    event ValueUpdated(bytes32 key, uint256 pendingAmount, uint256 finalizedAmount);

    /**
     * @notice Increases a test value into the pending amount for a given key.
     * @param key The generic key (e.g., "testBalance")
     * @param amount The amount to increase
     */
    function increaseTestValue(bytes32 key, uint256 amount) public {
        testValues.increaseValue(key, amount);
        emit ValueUpdated(key, testValues[key].pendingAmount, testValues[key].finalizedAmount);
    }

    /**
     * @notice Finalizes the pending test value for a given key.
     * @param key The generic key
     */
    function finalizeTestValue(bytes32 key) public {
        testValues.finalizeValue(key);
        emit ValueUpdated(key, testValues[key].pendingAmount, testValues[key].finalizedAmount);
    }

    /**
     * @notice Gets the total test value (pending + finalized) for a given key.
     * @param key The generic key
     * @return Total value (pending + finalized)
     */
    function getTotalTestValue(bytes32 key) public view returns (uint256) {
        return testValues.getTotalValue(key);
    }

    /**
     * @notice Attempts to increase a test value and finalize it in the same transaction.
     * @param key The generic key
     * @param amount The amount to increase
     */
    function increaseAndFinalizeImmediately(bytes32 key, uint256 amount) public {
        testValues.increaseValue(key, amount);
        testValues.finalizeValue(key); // Attempt to finalize immediately
        emit ValueUpdated(key, testValues[key].pendingAmount, testValues[key].finalizedAmount);
    }
}
