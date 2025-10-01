import { expect } from "chai";
import { ethers } from "hardhat";
import { type Signer } from "ethers";

import { DelayedFinalizationTest } from "../typechain-types/contracts/DelayedFinalizationTest";

describe("DelayedFinalizationTest", function () {
  let delayedFinalizationTest: DelayedFinalizationTest;
  let owner: Signer;
  const key = ethers.keccak256(ethers.toUtf8Bytes("testBalance"));
  const increaseAmount = ethers.parseEther("10.0");

  beforeEach(async function () {
    [owner] = await ethers.getSigners();
    const DelayedFinalizationTest = await ethers.getContractFactory("DelayedFinalizationTest");
    delayedFinalizationTest = await DelayedFinalizationTest.deploy();
    await delayedFinalizationTest.waitForDeployment();
  });

  it("Should fail when attempting to increase and finalize in the same transaction", async function () {
    await expect(delayedFinalizationTest.increaseAndFinalizeImmediately(key, increaseAmount)).to.be
      .reverted;
  });

  it("Should succeed in increasing, then finalize after a block delay (as before, for consistency)", async function () {
    // Increase value
    const increaseTx = await delayedFinalizationTest.increaseTestValue(key, increaseAmount);
    let totalValue = await delayedFinalizationTest.getTotalTestValue(key);
    expect(totalValue).to.equal(increaseAmount);

    // Ensure block has advanced
    await increaseTx.wait();

    // Value should be finalized
    totalValue = await delayedFinalizationTest.getTotalTestValue(key);
    expect(totalValue).to.equal(increaseAmount);

    // Run the `finalizeValue` function. Technically not necessary.
    await delayedFinalizationTest.finalizeTestValue(key);
    const totalValue2 = await delayedFinalizationTest.getTotalTestValue(key);
    expect(totalValue2).to.equal(increaseAmount);
  });
});
