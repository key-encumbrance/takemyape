import { expect } from "chai";
import { ethers } from "hardhat";
import { type Signer } from "ethers";

import { TrivialBlockHashOracle } from "../typechain-types/liquefaction/contracts/wallet/encumbrance-policies/examples/TrivialBlockHashOracle";
import { MultiBlockHashSetterProxy } from "../typechain-types/contracts/MultiBlockHashSetterProxy";

describe("MultiBlockHashSetterProxy", function () {
  let trivialBlockHashOracle: TrivialBlockHashOracle;
  let multiBlockHashSetterProxy: MultiBlockHashSetterProxy;
  let owner: Signer;
  let user: Signer;

  const blockNumbers = [1, 2, 3];
  const blockHashes = [
    ethers.keccak256(ethers.toUtf8Bytes("hash1")),
    ethers.keccak256(ethers.toUtf8Bytes("hash2")),
    ethers.keccak256(ethers.toUtf8Bytes("hash3")),
  ];

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    const TrivialBlockHashOracleFactory = await ethers.getContractFactory("TrivialBlockHashOracle");
    trivialBlockHashOracle = await TrivialBlockHashOracleFactory.deploy();
    await trivialBlockHashOracle.waitForDeployment();

    const MultiBlockHashSetterProxyFactory = await ethers.getContractFactory(
      "MultiBlockHashSetterProxy",
    );
    multiBlockHashSetterProxy = await MultiBlockHashSetterProxyFactory.deploy(
      trivialBlockHashOracle.getAddress(),
    );
    await multiBlockHashSetterProxy.waitForDeployment();
  });

  it("Should set multiple block hashes correctly", async function () {
    await trivialBlockHashOracle
      .transferOwnership(await multiBlockHashSetterProxy.getAddress())
      .then((r) => r.wait());
    await multiBlockHashSetterProxy
      .setMultipleBlockHashes(blockNumbers, blockHashes)
      .then((r) => r.wait());

    for (let i = 0; i < blockNumbers.length; i++) {
      const blockHash = await trivialBlockHashOracle.getBlockHash(blockNumbers[i]);
      expect(blockHash).to.equal(blockHashes[i]);
    }
  });

  it("Should revert when setting block hashes by a non-owner", async function () {
    await trivialBlockHashOracle
      .transferOwnership(await multiBlockHashSetterProxy.getAddress())
      .then((r) => r.wait());
    const userAddress = await user.getAddress();
    await expect(
      multiBlockHashSetterProxy
        .connect(user)
        .setMultipleBlockHashes.staticCall(blockNumbers, blockHashes),
    ).to.be.reverted;
  });

  it("Should transfer ownership correctly", async function () {
    await trivialBlockHashOracle
      .transferOwnership(await multiBlockHashSetterProxy.getAddress())
      .then((r) => r.wait());
    const userAddress = await user.getAddress();
    await multiBlockHashSetterProxy.transferOwnership(userAddress).then((r) => r.wait());
    await multiBlockHashSetterProxy
      .connect(user)
      .acceptOwnership()
      .then((r) => r.wait());
    await expect(
      multiBlockHashSetterProxy.connect(user).setMultipleBlockHashes(blockNumbers, blockHashes),
    ).to.not.be.reverted;

    for (let i = 0; i < blockNumbers.length; i++) {
      const blockHash = await trivialBlockHashOracle.getBlockHash(blockNumbers[i]);
      expect(blockHash).to.equal(blockHashes[i]);
    }
  });

  it("Should transfer parent ownership correctly", async function () {
    const prevOwner = await trivialBlockHashOracle.owner();
    await trivialBlockHashOracle
      .transferOwnership(await multiBlockHashSetterProxy.getAddress())
      .then((r) => r.wait());
    const userAddress = await user.getAddress();
    await multiBlockHashSetterProxy.transferOwnership(userAddress).then((r) => r.wait());
    await multiBlockHashSetterProxy
      .connect(user)
      .acceptOwnership()
      .then((r) => r.wait());
    await expect(
      multiBlockHashSetterProxy.connect(user).setMultipleBlockHashes(blockNumbers, blockHashes),
    ).to.not.be.reverted;

    await multiBlockHashSetterProxy
      .connect(user)
      .transferOracleOwnership(prevOwner)
      .then((r) => r.wait());
    await expect(trivialBlockHashOracle.owner()).to.eventually.equal(prevOwner);
  });
});
