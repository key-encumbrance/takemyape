import { EIP155_SIGNING_METHODS } from "@/data/EIP155Data";
import ModalStore from "@/store/ModalStore";
import SettingsStore from "@/store/SettingsStore";
import { walletkit } from "@/utils/WalletConnectUtil";
import { SignClientTypes } from "@walletconnect/types";
import { useCallback, useEffect, useMemo } from "react";

export default function useWalletConnectEventsManager(initialized: boolean) {
  /******************************************************************************
   * 1. Open session proposal modal for confirmation / rejection
   *****************************************************************************/
  const onSessionProposal = useCallback(
    (proposal: SignClientTypes.EventArguments["session_proposal"]) => {
      // set the verify context so it can be displayed in the projectInfoCard
      console.log("Proposal", proposal);
      SettingsStore.setCurrentRequestVerifyContext(proposal.verifyContext);
      ModalStore.open("SessionProposalModal", { proposal });
    },
    [],
  );

  /******************************************************************************
   * 2. Open request handling modal based on method that was used
   *****************************************************************************/
  const onSessionRequest = useCallback(
    async (requestEvent: SignClientTypes.EventArguments["session_request"]) => {
      const { topic, params, verifyContext, id } = requestEvent;
      const { request } = params;
      const requestSession = walletkit.engine.signClient.session.get(topic);
      // set the verify context so it can be displayed in the projectInfoCard
      SettingsStore.setCurrentRequestVerifyContext(verifyContext);
      switch (request.method) {
        case EIP155_SIGNING_METHODS.ETH_SIGN:
        case EIP155_SIGNING_METHODS.PERSONAL_SIGN: {
          return ModalStore.open("SessionSignModal", {
            requestEvent,
            requestSession,
          });
        }

        case EIP155_SIGNING_METHODS.ETH_SIGN_TYPED_DATA:
        case EIP155_SIGNING_METHODS.ETH_SIGN_TYPED_DATA_V3:
        case EIP155_SIGNING_METHODS.ETH_SIGN_TYPED_DATA_V4:
          return ModalStore.open("SessionSignTypedDataModal", {
            requestEvent,
            requestSession,
          });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onSessionAuthenticate = useCallback(
    (authRequest: SignClientTypes.EventArguments["session_authenticate"]) => {
      ModalStore.open("SessionAuthenticateModal", { authRequest });
    },
    [],
  );

  /******************************************************************************
   * Set up WalletConnect event listeners
   *****************************************************************************/
  useEffect(() => {
    if (initialized && walletkit) {
      console.log("Initializing WalletConnect event listeners");
      //sign
      walletkit.on("session_proposal", onSessionProposal);
      walletkit.on("session_request", onSessionRequest);
      // TODOs
      walletkit.engine.signClient.events.on("session_ping", (data) =>
        console.log("ping", data),
      );
      walletkit.on("session_authenticate", onSessionAuthenticate);
    } else {
      console.log("Walletkit not initialized");
    }
  }, [initialized, onSessionAuthenticate, onSessionProposal, onSessionRequest]);
}
