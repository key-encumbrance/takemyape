/* eslint-disable react-hooks/rules-of-hooks */
import { Divider, Text, Row, Col } from "@nextui-org/react";
import { Fragment, useCallback, useState, useEffect } from "react";
import { useConnectorClient } from "wagmi";
import { type Config } from "wagmi";
import ClientStore from "@/store/ClientStore";

import RequestDataCard from "@/components/RequestDataCard";
import RequesDetailsCard from "@/components/RequestDetalilsCard";
import RequestMethodCard from "@/components/RequestMethodCard";
import ModalStore from "@/store/ModalStore";
import {
  approveEIP155Request,
  rejectEIP155Request,
} from "@/utils/EIP155RequestHandlerUtil";
import { getSignTypedDataParamsData, styledToast } from "@/utils/HelperUtil";
import { walletkit } from "@/utils/WalletConnectUtil";
import RequestModal from "../components/RequestModal";
import PermissionDetailsCard from "@/components/PermissionDetailsCard";

export default function SessionSignTypedDataModal() {
  // Get request and wallet data from store
  const requestEvent = ModalStore.state.data?.requestEvent;
  const requestSession = ModalStore.state.data?.requestSession;
  const { data: client } = useConnectorClient<Config>();

  // Loading states for buttons
  const [isLoadingApprove, setIsLoadingApprove] = useState(false);
  const [isLoadingReject, setIsLoadingReject] = useState(false);

  // Update ClientStore when client changes
  useEffect(() => {
    if (client) {
      ClientStore.setClient(client);
    }
  }, [client]);

  // Ensure request and wallet are defined
  if (!requestEvent || !requestSession) {
    return <Text>Missing request data</Text>;
  }

  // Get required request data
  const { topic, params } = requestEvent;
  const { request, chainId } = params;
  let method = request.method;
  // Get data
  const data = getSignTypedDataParamsData(request.params);

  const isPermissionRequest = data?.domain?.name === "eth_getPermissions_v1";
  let permissionScope = [];
  if (isPermissionRequest) {
    permissionScope = data?.message?.scope || [];
    method = "eth_getPermissions_v1";
    console.log({ permissionScope });
  }
  // Handle approve action (logic varies based on request method)
  const onApprove = useCallback(async () => {
    try {
      if (requestEvent) {
        setIsLoadingApprove(true);
        const response = await approveEIP155Request(requestEvent);
        await walletkit.respondSessionRequest({
          topic,
          response,
        });
      }
    } catch (e) {
      styledToast((e as Error).message, "error");
    } finally {
      setIsLoadingApprove(false);
      ModalStore.close();
    }
  }, [requestEvent, topic]);

  // Handle reject action
  const onReject = useCallback(async () => {
    if (requestEvent) {
      try {
        setIsLoadingReject(true);
        const response = rejectEIP155Request(requestEvent);

        try {
          await walletkit.respondSessionRequest({
            topic,
            response,
          });
        } catch (respondError) {
          console.log("Error responding to session request:", respondError);
          // Check if this is a user rejection error, which we can safely ignore
          if (
            respondError instanceof Error &&
            (respondError.message.includes("user rejected") ||
              respondError.message.includes("User rejected") ||
              respondError.message.includes("ACTION_REJECTED"))
          ) {
            console.log("User rejected the request, this is expected behavior");
            // We can safely ignore user rejection errors
          } else {
            // For other errors, show a toast
            styledToast(
              `Error: ${respondError instanceof Error ? respondError.message : "Unknown error"}`,
              "error",
            );
          }
        }
      } catch (e) {
        console.error("Error in onReject:", e);
      } finally {
        setIsLoadingReject(false);
        ModalStore.close();
      }
    }
  }, [requestEvent, topic]);
  return (
    <RequestModal
      intention="sign a message"
      metadata={requestSession.peer.metadata}
      onApprove={onApprove}
      onReject={onReject}
      approveLoader={{ active: isLoadingApprove }}
      rejectLoader={{ active: isLoadingReject }}
    >
      <RequesDetailsCard
        chains={[chainId ?? ""]}
        protocol={requestSession.relay.protocol}
      />
      <Divider y={1} />
      {isPermissionRequest && permissionScope.length > 0 ? (
        <PermissionDetailsCard scope={permissionScope} />
      ) : (
        <RequestDataCard data={data} />
      )}
      <Divider y={1} />
      <RequestMethodCard methods={[method]} />
    </RequestModal>
  );
}
