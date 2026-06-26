import { Suspense } from "react";
import { Chat } from "@/features/chat/Chat";

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <Chat />
    </Suspense>
  );
}
