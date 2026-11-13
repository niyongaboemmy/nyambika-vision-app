"use client";

import { BackButton } from "@/components/back-link";
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
        <BackButton fallback={`/studio/${page.id}/settings`} label="Back" className="st-press grid size-11 shrink-0 place-items-center rounded-full bg-white text-cocoa" />
        <SectionTitle title="Training data" eyebrow="Settings" as="h1" />
      </div>
      {manager ? <TrainingDataConsent pageId={page.id} /> : page.memberType === "COOPERATIVE" ? <MakerTrainingConsent pageId={page.id} /> : <Note error="Only the page owner or cooperative admin can decide this." />}
    </div>
  );
}
