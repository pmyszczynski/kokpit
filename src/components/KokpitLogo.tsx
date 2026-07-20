import Image from "next/image";

export default function KokpitLogo() {
  return (
    <span className="kokpit-logo">
      <Image
        alt=""
        aria-hidden="true"
        height={28}
        priority
        role="img"
        src="/brand/kokpit/kokpit-mark-navbar.svg"
        width={28}
      />
      <span className="kokpit-logo__wordmark">kokpit</span>
    </span>
  );
}
