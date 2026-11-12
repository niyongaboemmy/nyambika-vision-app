"use client";

import { SignInFlow } from "@/components/signin-flow";
import { Sheet } from "@/components/ui";
import { finishSignIn, type SignInAsk } from "@/lib/auth-ask";
import { useSession } from "@/lib/session";

/**
 * The sign-in sheet (navigation pass): opened by `askSignIn()` over whatever the shopper is doing, so a Buy,
 * Follow, Ask a tailor or reaction resumes on the same screen once the phone is verified. Loaded on demand.
 */
export default function AuthSheet({ ask }: { ask: SignInAsk }) {
  const { t } = useSession();
  return (
    <Sheet open onClose={() => finishSignIn(false)} title={ask.reason ?? t("auth.title")}>
      <div className="pb-2">
        <SignInFlow key={ask.id} allowInvite={false} onDone={() => finishSignIn(true)} />
      </div>
    </Sheet>
  );
}
