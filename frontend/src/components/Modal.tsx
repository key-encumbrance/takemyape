import ModalStore from "@/store/ModalStore";
import SessionProposalModal from "@/views/SessionProposalModal";
import SessionSignModal from "@/views/SessionSignModal";
import SessionSignTypedDataModal from "@/views/SessionSignTypedDataModal";
import { Modal as NextModal } from "@nextui-org/react";
import { useSnapshot } from "valtio";
import { useCallback, useMemo } from "react";
import SessionAuthenticateModal from "@/views/SessionAuthenticateModal";

export default function Modal() {
  const { open, view } = useSnapshot(ModalStore.state);
  // handle the modal being closed by click outside
  const onClose = useCallback(() => {
    if (open) {
      ModalStore.close();
    }
  }, [open]);

  const componentView = useMemo(() => {
    switch (view) {
      case "SessionProposalModal":
        return <SessionProposalModal />;
      case "SessionSignModal":
        return <SessionSignModal />;
      case "SessionSignTypedDataModal":
        return <SessionSignTypedDataModal />;
      case "SessionAuthenticateModal":
        return <SessionAuthenticateModal />;
      default:
        return null;
    }
  }, [view]);

  return (
    <NextModal
      blur
      onClose={onClose}
      open={open}
      style={{ border: "1px solid rgba(139, 139, 139, 0.4)" }}
    >
      {componentView}
    </NextModal>
  );
}
