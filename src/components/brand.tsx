import Link from "next/link";
import Image from "next/image";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" href="/" aria-label="BBK AUCTION หน้าแรก">
      <span className="brand-logo" aria-hidden="true">
        <Image alt="" fill priority sizes="56px" src="/brand/bbk-auction-logo.png" />
      </span>
      {!compact && (
        <span className="brand-copy">
          <strong>BBK</strong>
          <small>AUCTION</small>
        </span>
      )}
    </Link>
  );
}
