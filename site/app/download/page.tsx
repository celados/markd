import type { Metadata } from "next";
import { Apple } from "lucide-react";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { DownloadLink } from "@/components/download/DownloadLink";
import { PlatformCard } from "@/components/download/PlatformCard";
import { AnalyticsEvent } from "@/components/analytics/AnalyticsEvent";
import { DMG, VERSION } from "@/lib/config";

export const metadata: Metadata = {
  title: "Download for macOS",
  description: "Download Riffle for Apple Silicon Macs.",
  alternates: {
    canonical: "/download",
  },
  openGraph: {
    title: "Download Riffle for macOS",
    description: "Download the signed and notarized macOS app.",
    url: "/download",
  },
};

export default function DownloadPage() {
  return (
    <>
      <AnalyticsEvent event="download_page_viewed" properties={{}} />
      <Nav />
      <main className="px-5 pb-14 pt-24 sm:px-8 sm:pt-28">
        <section className="mx-auto w-full max-w-5xl text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">
            Riffle {VERSION}
          </p>
          <h1 className="mx-auto mt-3 max-w-3xl text-balance font-serif text-[44px] leading-[0.98] tracking-[-0.035em] text-foreground sm:text-[56px]">
            Download Riffle.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-[14px] leading-6 text-muted-foreground">
            A quiet, local-first writing experience for Apple Silicon Macs.
          </p>
        </section>

        <section
          aria-label="Available Riffle downloads"
          className="mx-auto mt-8 grid w-full max-w-xl gap-4 sm:mt-10"
        >
          <PlatformCard
            index="01"
            icon={<Apple className="size-[18px]" strokeWidth={1.7} />}
            platform="macOS"
            architecture="Apple Silicon"
            description="A native disk image for modern Macs. Open it, move Riffle to Applications, and start writing."
            details={[
              "macOS 12 or newer",
              "Signed with Developer ID",
              "Notarized by Apple",
            ]}
          >
            <DownloadLink
              href={DMG}
              label="Download .dmg"
              platform="macos"
              format="dmg"
              primary
            />
          </PlatformCard>

        </section>

        <p className="mx-auto mt-4 max-w-5xl text-center font-mono text-[10.5px] tracking-[0.08em] text-faint">
          Free and open source · No account · Your notes stay on your disk
        </p>
      </main>
      <Footer />
    </>
  );
}
