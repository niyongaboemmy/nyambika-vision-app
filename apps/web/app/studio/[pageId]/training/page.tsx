"use client";

import Link from "next/link";
import { Icon, Note, SectionTitle } from "@/components/studio";
import { MakerTrainingConsent, TrainingDataConsent } from "@/components/mlspike-training";
import { useManagedPage } from "../layout";

/** R4 spike: maker opt-in for contributing garment photos to the local model's training data. */
export default function TrainingPage() {
  const { page } = useManagedPage();
  const manager = page.myAccess === "MANAGER";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href={`/studio/${page.id}/settings`} aria-label="Back to settings" className="st-press grid size-11 shrink-0 place-items-center rounded-full bg-white text-cocoa ring-1 ring-inset ring-hairline">
          <Icon name="back" className="size-5" />
        </Link>
        <SectionTitle title="Training data" eyebrow="Settings" as="h1" />
      </div>
      {manager ? <TrainingDataConsent pageId={page.id} /> : page.memberType === "COOPERATIVE" ? <MakerTrainingConsent pageId={page.id} /> : <Note error="Only the page owner or cooperative admin can decide this." />}
    </div>
  );
}
