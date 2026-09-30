import Link from "next/link";
import Image from "next/image";

export function Brand({ compact = false, market = false }: { compact?: boolean; market?: boolean }) {
  return (
    <Link className="brand" href="/" aria-label="BBK AUCTION หน้าแรก">
      <span className="brand-logo" aria-hidden="true">
        <Image alt="" fill priority sizes="56px" src="/brand/bbk-auction-logo.png" />
      </span>
      {!compact && (
        <span className="brand-copy">
          <strong>{market ? "BBK AUCTION" : "BBK"}</strong>
          <small>{market ? "COLLECTIBLES MARKET" : "AUCTION"}</small>
        </span>
      )}
    </Link>
  );
}
