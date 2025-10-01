// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title DelayedFinalizationLibrary
 * @notice Provides functions for managing values with a delayed finalization
 *         mechanism. Value increases always refer to increases in privilege.
 */
library DelayedFinalization {
    struct ValueStatus {
        // Amount pending finalization (considered finalized if block number > pendingBlockNumber)
        uint256 pendingAmount;
        // Amount already finalized
        uint256 finalizedAmount;
        // Block number when pending amount was set
        uint256 pendingBlockNumber;
    }

    // TODO: Are there any security risks with this? It relies strongly on the
    // assumption that value decreases reduce privilege.
    /**
     * @notice Decreases finalized value
     * @param values Storage mapping for all values (pending and finalized)
     * @param key The generic key (e.g., "balances", "stakes", etc.)
     * @param amount Amount to decrease
     */
    function decreaseValue(mapping(bytes32 => ValueStatus) storage values, bytes32 key, uint256 amount) internal {
        if (values[key].pendingAmount > 0 && values[key].pendingBlockNumber < block.number) {
            finalizeValue(values, key);
        }
        uint256 thisFinalizedValue = finalizedValue(values, key);
        require(amount <= thisFinalizedValue, "Decrease greater than finalized value");
        values[key].finalizedAmount -= amount;
    }

    /**
     * @notice Sets a value into the pending amount for a given key, under the
     * assumption that the new value increases the old value. (Should NOT use
     * with decreaseValue/increaseValue in case you accidentally allow a
     * decreaseValue and then call setIncreasedValue.)
     * @param values Storage mapping for all values (pending and finalized)
     * @param key The generic key (e.g., "balances", "stakes", etc.)
     * @param value The new value to set
     */
    function setIncreasedValue(mapping(bytes32 => ValueStatus) storage values, bytes32 key, uint256 value) internal {
        uint256 thisFinalizedValue = finalizedValue(values, key);
        require(value >= thisFinalizedValue, "Value decrease given to setIncreasedValue");
        increaseValue(values, key, value - thisFinalizedValue);
    }

    /**
     * @notice Increases a value into the pending amount for a given key.
     * @param values Storage mapping for all values (pending and finalized)
     * @param key The generic key (e.g., "balances", "stakes", etc.)
     * @param amount The amount to increase
     */
    function increaseValue(mapping(bytes32 => ValueStatus) storage values, bytes32 key, uint256 amount) internal {
        if (amount == 0) {
            // No increase
            return;
        }

        if (values[key].pendingBlockNumber != 0) {
            if (values[key].pendingBlockNumber < block.number) {
                finalizeValue(values, key);
                values[key] = ValueStatus(amount, values[key].finalizedAmount, block.number);
            } else {
                values[key].pendingAmount += amount;
            }
        } else {
            values[key] = ValueStatus(amount, 0, block.number);
        }
    }

    /**
     * @notice Finalizes the pending value for a given key after a block delay.
     * @param values Storage mapping for all values (pending and finalized)
     * @param key The generic key
     */
    function finalizeValue(mapping(bytes32 => ValueStatus) storage values, bytes32 key) internal {
        // require(values[key].pendingBlockNumber != 0, "No pending value.");
        require(values[key].pendingBlockNumber < block.number, "Need to wait for another block before finalizing.");
        values[key].finalizedAmount += values[key].pendingAmount;
        values[key].pendingAmount = 0;
        values[key].pendingBlockNumber = 0; // Reset pending block number
    }

    /**
     * @notice Gets the total value (pending + finalized) for a given key.
     * @param values Storage mapping for all values (pending and finalized)
     * @param key The generic key
     * @return Total value (pending + finalized)
     */
    function getTotalValue(
        mapping(bytes32 => ValueStatus) storage values,
        bytes32 key
    ) internal view returns (uint256) {
        return values[key].pendingAmount + values[key].finalizedAmount;
    }

    /**
     * @notice Gets the total value considered finalized for a given key.
     * @param values Storage mapping for all values (pending and finalized)
     * @param key The generic key
     * @return Total finalized value
     */
    function finalizedValue(
        mapping(bytes32 => ValueStatus) storage values,
        bytes32 key
    ) internal view returns (uint256) {
        return
            ((values[key].pendingBlockNumber < block.number) ? values[key].pendingAmount : 0) +
            values[key].finalizedAmount;
    }
}
