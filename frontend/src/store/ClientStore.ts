import { Client, Transport, Chain, Account } from "viem";
import { proxy } from "valtio";

/**
 * ClientStore - Global store for the Wagmi client instance
 * This allows components that don't have access to the React context
 * to still access the client for making RPC calls
 */

interface ClientState {
  client: Client<Transport, Chain, Account> | null;
}

const state = proxy<ClientState>({
  client: null,
});

const ClientStore = {
  state,

  setClient(client: Client<Transport, Chain, Account> | null) {
    state.client = client;
  },

  getClient() {
    return state.client;
  },
};

export default ClientStore;
