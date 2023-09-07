import { defaultAbiCoder } from "@ethersproject/abi";
import { AddressZero } from "@ethersproject/constants";
import { Contract } from "@ethersproject/contracts";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  Intent,
  generateMerkleProof,
  generateMerkleTree,
  signIntent,
} from "./utils";
import {
  bn,
  getCurrentTimestamp,
  getRandomBoolean,
  getRandomInteger,
} from "../utils";
import { PERMIT2, USDC } from "../../src/common/addresses";

describe("[ERC721] Criteria", async () => {
  let chainId: number;

  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let memswap: Contract;

  let solutionProxy: Contract;
  let token0: Contract;
  let token1: Contract;

  beforeEach(async () => {
    chainId = await ethers.provider.getNetwork().then((n) => n.chainId);

    [deployer, alice, bob] = await ethers.getSigners();

    memswap = await ethers
      .getContractFactory("MemswapERC721")
      .then((factory) => factory.deploy(PERMIT2[chainId], USDC[chainId]));

    solutionProxy = await ethers
      .getContractFactory("MockSolutionProxyERC721")
      .then((factory) => factory.deploy(memswap.address));
    token0 = await ethers
      .getContractFactory("MockERC20")
      .then((factory) => factory.deploy());
    token1 = await ethers
      .getContractFactory("MockERC721")
      .then((factory) => factory.deploy());

    // Send some ETH to solution proxy contract for the tests where `tokenOut` is ETH
    await deployer.sendTransaction({
      to: solutionProxy.address,
      value: ethers.utils.parseEther("10"),
    });
  });

  it("No criteria", async () => {
    const currentTime = await getCurrentTimestamp();

    // Generate intent
    const intent: Intent = {
      isBuy: true,
      buyToken: token1.address,
      sellToken: token0.address,
      maker: alice.address,
      matchmaker: AddressZero,
      source: AddressZero,
      feeBps: 0,
      surplusBps: 0,
      startTime: currentTime,
      endTime: currentTime + 60,
      nonce: 0,
      isPartiallyFillable: true,
      hasCriteria: false,
      tokenIdOrCriteria: 999,
      amount: 2,
      endAmount: ethers.utils.parseEther("0.3"),
      startAmountBps: 0,
      expectedAmountBps: 0,
      hasDynamicSignature: false,
    };
    intent.signature = await signIntent(alice, memswap.address, intent);

    // Mint and approve
    await token0.connect(alice).mint(intent.endAmount);
    await token0.connect(alice).approve(memswap.address, intent.endAmount);

    // When the intent has no criteria, a single token id can be used for filling
    await expect(
      solutionProxy.connect(bob).solve(
        [intent],
        {
          data: defaultAbiCoder.encode(
            ["address", "uint256[]"],
            [intent.buyToken, [888]]
          ),
          fillTokenDetails: [
            [
              {
                tokenId: 888,
                criteriaProof: [],
              },
            ],
          ],
          executeAmounts: [bn(intent.endAmount).div(2)],
        },
        []
      )
    ).to.be.revertedWith("InvalidTokenId");

    // Succeeds when the fill token id matches `tokenIdOrCriteria`
    await solutionProxy.connect(bob).solve(
      [intent],
      {
        data: defaultAbiCoder.encode(
          ["address", "uint256[]"],
          [intent.buyToken, [intent.tokenIdOrCriteria]]
        ),
        fillTokenDetails: [
          [
            {
              tokenId: intent.tokenIdOrCriteria,
              criteriaProof: [],
            },
          ],
        ],
        executeAmounts: [bn(intent.endAmount).div(2)],
      },
      []
    );
  });

  it("Empty criteria", async () => {
    const currentTime = await getCurrentTimestamp();

    // Generate intent
    const intent: Intent = {
      isBuy: true,
      buyToken: token1.address,
      sellToken: token0.address,
      maker: alice.address,
      matchmaker: AddressZero,
      source: AddressZero,
      feeBps: 0,
      surplusBps: 0,
      startTime: currentTime,
      endTime: currentTime + 60,
      nonce: 0,
      isPartiallyFillable: true,
      hasCriteria: true,
      tokenIdOrCriteria: 0,
      amount: 4,
      endAmount: ethers.utils.parseEther("0.3"),
      startAmountBps: 0,
      expectedAmountBps: 0,
      hasDynamicSignature: false,
    };
    intent.signature = await signIntent(alice, memswap.address, intent);

    // Mint and approve
    await token0.connect(alice).mint(intent.endAmount);
    await token0.connect(alice).approve(memswap.address, intent.endAmount);

    // When the criteria is `0`, any token id can be used for filling
    const randomTokenId = getRandomInteger(1, 100000);
    await solutionProxy.connect(bob).solve(
      [intent],
      {
        data: defaultAbiCoder.encode(
          ["address", "uint256[]"],
          [intent.buyToken, [randomTokenId]]
        ),
        fillTokenDetails: [
          [
            {
              tokenId: randomTokenId,
              criteriaProof: [],
            },
          ],
        ],
        executeAmounts: [bn(intent.endAmount).div(4)],
      },
      []
    );
  });

  const fullCriteria = async () => {
    const currentTime = await getCurrentTimestamp();

    const criteriaTokenIds = [
      ...new Set(
        [...Array(getRandomInteger(1, 1000)).keys()].map(() =>
          getRandomInteger(1, 100000)
        )
      ),
    ];
    const tree = generateMerkleTree(criteriaTokenIds);
    const criteria = tree.getHexRoot();

    const isBuy = getRandomBoolean();
    if (isBuy) {
      // Generate intent
      const intent: Intent = {
        isBuy,
        buyToken: token1.address,
        sellToken: token0.address,
        maker: alice.address,
        matchmaker: AddressZero,
        source: AddressZero,
        feeBps: 0,
        surplusBps: 0,
        startTime: currentTime,
        endTime: currentTime + 60,
        nonce: 0,
        isPartiallyFillable: true,
        hasCriteria: true,
        tokenIdOrCriteria: criteria,
        amount: 1,
        endAmount: ethers.utils.parseEther("0.3"),
        startAmountBps: 0,
        expectedAmountBps: 0,
        hasDynamicSignature: false,
      };
      intent.signature = await signIntent(alice, memswap.address, intent);

      // Mint and approve
      await token0.connect(alice).mint(intent.endAmount);
      await token0.connect(alice).approve(memswap.address, intent.endAmount);

      const randomTokenId = getRandomBoolean()
        ? criteriaTokenIds[getRandomInteger(0, criteriaTokenIds.length - 1)]
        : getRandomInteger(1, 100000);
      if (criteriaTokenIds.includes(randomTokenId)) {
        await solutionProxy.connect(bob).solve(
          [intent],
          {
            data: defaultAbiCoder.encode(
              ["address", "uint256[]"],
              [intent.buyToken, [randomTokenId]]
            ),
            fillTokenDetails: [
              [
                {
                  tokenId: randomTokenId,
                  criteriaProof: generateMerkleProof(tree, randomTokenId),
                },
              ],
            ],
            executeAmounts: [intent.endAmount],
          },
          []
        );
      } else {
        await expect(
          solutionProxy.connect(bob).solve(
            [intent],
            {
              data: defaultAbiCoder.encode(
                ["address", "uint256[]"],
                [intent.buyToken, [randomTokenId]]
              ),
              fillTokenDetails: [
                [
                  {
                    tokenId: randomTokenId,
                    criteriaProof: generateMerkleProof(tree, randomTokenId),
                  },
                ],
              ],
              executeAmounts: [intent.endAmount],
            },
            []
          )
        ).to.be.revertedWith("InvalidCriteriaProof");
      }
    }
  };

  const RUNS = 50;
  for (let i = 0; i < RUNS; i++) {
    it(`Full criteria (run ${i + 1})`, async () => fullCriteria());
  }
});