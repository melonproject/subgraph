import {
  FeeRegistration,
  FeeReward
} from "../codegen/templates/FeeManagerDataSource/FeeManagerContract";
import {
  FeeManager,
  ManagementFee,
  PerformanceFee,
  FeeRewardHistory,
  InvestmentHistory
} from "../codegen/schema";
import { investmentEntity } from "../entities/investmentEntity";
import { FeeManagerContract } from "../codegen/templates/FeeManagerDataSource/FeeManagerContract";
import { HubContract } from "../codegen/templates/FeeManagerDataSource/HubContract";
import { BigInt } from "@graphprotocol/graph-ts";
import { ManagementFeeContract } from "../codegen/templates/FeeManagerDataSource/ManagementFeeContract";
import { PerformanceFeeContract } from "../codegen/templates/FeeManagerDataSource/PerformanceFeeContract";
import { AccountingContract } from "../codegen/templates/FeeManagerDataSource/AccountingContract";
import { saveEventHistory } from "../utils/saveEventHistory";

export function handleFeeRegistration(event: FeeRegistration): void {
  // this event only passes very limited data, so
  // we have to get everything through contract calls...
  let feeManager = FeeManager.load(event.address.toHex());
  if (!feeManager) {
    feeManager = new FeeManager(event.address.toHex());
    feeManager.feesRegistered = BigInt.fromI32(0);
    feeManager.save();
  }
  let feeManagerContract = FeeManagerContract.bind(event.address);

  // fee[0] is the management fee
  if (
    !feeManager.feesRegistered ||
    feeManager.feesRegistered.equals(BigInt.fromI32(0))
  ) {
    let mgmtFeeAddress = feeManagerContract.fees(BigInt.fromI32(0));
    let mgmtFeeContract = ManagementFeeContract.bind(mgmtFeeAddress);
    let mgmtFee = new ManagementFee(event.address.toHex() + "/mgmt");
    mgmtFee.feeManager = event.address.toHex();
    mgmtFee.managementFeeRate = mgmtFeeContract.managementFeeRate(
      event.address
    );
    mgmtFee.save();
    feeManager.feesRegistered = BigInt.fromI32(1);
    feeManager.save();

    saveEventHistory(
      event.transaction.hash.toHex() + "/mgmt",
      event.block.timestamp,
      feeManagerContract.hub().toHex(),
      "FeeManager",
      event.address.toHex(),
      "FeeRegistration",
      ["feeType", "rate"],
      ["Management Fee", mgmtFee.managementFeeRate.toString()]
    );
  }
  // fee[1] is the performance fee
  else {
    let perfFeeAddress = feeManagerContract.fees(BigInt.fromI32(1));
    let perfFeeContract = PerformanceFeeContract.bind(perfFeeAddress);
    let perfFee = new PerformanceFee(event.address.toHex() + "/perf");
    perfFee.feeManager = event.address.toHex();
    perfFee.performanceFeeRate = perfFeeContract.performanceFeeRate(
      event.address
    );
    perfFee.performanceFeePeriod = perfFeeContract.performanceFeePeriod(
      event.address
    );
    perfFee.initializeTime = perfFeeContract.initializeTime(event.address);
    perfFee.save();
    feeManager.feesRegistered = BigInt.fromI32(2);
    feeManager.save();

    saveEventHistory(
      event.transaction.hash.toHex() + "/perf",
      event.block.timestamp,
      feeManagerContract.hub().toHex(),
      "FeeManager",
      event.address.toHex(),
      "FeeRegistration",
      ["feeType", "rate", "period"],
      [
        "Performance Fee",
        perfFee.performanceFeeRate.toString(),
        perfFee.performanceFeePeriod.toString()
      ]
    );
  }
}

export function handleFeeReward(event: FeeReward): void {
  let feeRewardHistory = new FeeRewardHistory(
    event.address.toHex() + "/" + event.block.timestamp.toString()
  );
  feeRewardHistory.feeManager = event.address.toHex();
  feeRewardHistory.shares = event.params.shareQuantity;
  feeRewardHistory.timestamp = event.block.timestamp;
  feeRewardHistory.save();

  let feeManager =
    FeeManager.load(event.address.toHex()) ||
    new FeeManager(event.address.toHex());
  feeManager.totalFeeReward = feeManager.totalFeeReward.plus(
    event.params.shareQuantity
  );
  feeManager.save();

  // add rewardeded fees to manager's investment
  let feeManagerContract = FeeManagerContract.bind(event.address);
  let hubAddress = feeManagerContract.hub();
  let hubContract = HubContract.bind(hubAddress);
  let managerAddress = hubContract.manager();
  let accountingContract = AccountingContract.bind(hubContract.accounting());

  let investment = investmentEntity(
    managerAddress.toHex(),
    hubAddress.toHex(),
    event.block.timestamp
  );
  investment.shares = investment.shares.plus(event.params.shareQuantity);
  investment.save();

  let currentSharePrice = BigInt.fromI32(0);
  if (accountingContract.try_calcSharePrice().reverted) {
    // nothing to do
  } else {
    currentSharePrice = accountingContract.try_calcSharePrice().value;
  }

  let defaultSharePrice = accountingContract.DEFAULT_SHARE_PRICE();
  let asset = accountingContract.NATIVE_ASSET();

  let amount = currentSharePrice
    .times(event.params.shareQuantity)
    .div(defaultSharePrice);

  let investmentHistory = new InvestmentHistory(
    event.transaction.hash.toHex() + "/" + event.logIndex.toString()
  );
  investmentHistory.timestamp = event.block.timestamp;
  investmentHistory.investment =
    managerAddress.toHex() + "/" + hubAddress.toHex();
  investmentHistory.owner = managerAddress.toHex();
  investmentHistory.fund = hubAddress.toHex();
  investmentHistory.action = "Fee allocation";
  investmentHistory.shares = event.params.shareQuantity;
  investmentHistory.sharePrice = currentSharePrice;
  investmentHistory.amount = amount;
  investmentHistory.asset = asset.toHex();
  investmentHistory.amountInDenominationAsset = amount;
  investmentHistory.save();

  saveEventHistory(
    event.transaction.hash.toHex(),
    event.block.timestamp,
    hubAddress.toHex(),
    "FeeManager",
    event.address.toHex(),
    "FeeReward",
    ["shares"],
    [event.params.shareQuantity.toString()]
  );
}
