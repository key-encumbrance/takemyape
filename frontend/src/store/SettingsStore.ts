import { Verify, SessionTypes } from "@walletconnect/types";
import { proxy } from "valtio";

const TEST_NETS_ENABLED_KEY = "TEST_NETS";
const CA_ENABLED_KEY = "CHAIN_ABSTRACTION";
const MODULE_MANAGEMENT_ENABLED_KEY = "MODULE_MANAGEMENT";

/**
 * Types
 */
interface State {
  testNets: boolean;
  account: number;
  eip155Address: string;
  cosmosAddress: string;
  solanaAddress: string;
  polkadotAddress: string;
  nearAddress: string;
  multiversxAddress: string;
  tronAddress: string;
  tezosAddress: string;
  kadenaAddress: string;
  bip122Address: string;
  relayerRegionURL: string;
  activeChainId: string;
  currentRequestVerifyContext?: Verify.Context;
  sessions: SessionTypes.Struct[];
  moduleManagementEnabled: boolean;
  chainAbstractionEnabled: boolean;
}

/**
 * State
 */
const state = proxy<State>({
  testNets:
    typeof localStorage !== "undefined"
      ? Boolean(localStorage.getItem(TEST_NETS_ENABLED_KEY))
      : true,
  account: 0,
  activeChainId: "1",
  eip155Address: "",
  cosmosAddress: "",
  solanaAddress: "",
  polkadotAddress: "",
  nearAddress: "",
  multiversxAddress: "",
  tronAddress: "",
  tezosAddress: "",
  kadenaAddress: "",
  bip122Address: "",
  relayerRegionURL: "",
  sessions: [],
  moduleManagementEnabled:
    typeof localStorage !== "undefined"
      ? Boolean(localStorage.getItem(MODULE_MANAGEMENT_ENABLED_KEY))
      : false,
  chainAbstractionEnabled:
    typeof localStorage !== "undefined"
      ? Boolean(localStorage.getItem(CA_ENABLED_KEY))
      : false,
});

/**
 * Store / Actions
 */
const SettingsStore = {
  state,

  setAccount(value: number) {
    state.account = value;
  },

  setEIP155Address(eip155Address: string) {
    state.eip155Address = eip155Address;
  },

  setActiveChainId(value: string) {
    state.activeChainId = value;
  },

  setCurrentRequestVerifyContext(context: Verify.Context) {
    state.currentRequestVerifyContext = context;
  },
  setSessions(sessions: SessionTypes.Struct[]) {
    console.log("setSessions", sessions);
    state.sessions = sessions;
  },

  toggleTestNets() {
    state.testNets = !state.testNets;
    if (state.testNets) {
      localStorage.setItem(TEST_NETS_ENABLED_KEY, "YES");
    } else {
      localStorage.removeItem(TEST_NETS_ENABLED_KEY);
    }
  },

  toggleModuleManagement() {
    state.moduleManagementEnabled = !state.moduleManagementEnabled;
    if (state.moduleManagementEnabled) {
      localStorage.setItem(MODULE_MANAGEMENT_ENABLED_KEY, "YES");
    } else {
      localStorage.removeItem(MODULE_MANAGEMENT_ENABLED_KEY);
    }
  },

  toggleChainAbstractionEnabled() {
    state.chainAbstractionEnabled = !state.chainAbstractionEnabled;
    if (state.chainAbstractionEnabled) {
      localStorage.setItem(CA_ENABLED_KEY, "YES");
    } else {
      localStorage.removeItem(CA_ENABLED_KEY);
    }
  },
};

export default SettingsStore;
