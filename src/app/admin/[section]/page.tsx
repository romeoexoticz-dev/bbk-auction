import { notFound } from "next/navigation";
import { AdminDashboardContent, type AdminSection } from "@/app/admin/page";

const adminSections = new Set<AdminSection>([
  "auctions",
  "members",
  "interests",
  "payments",
  "shipping",
  "fulfillment",
  "defaults",
  "team",
  "security",
  "audit",
]);

export default async function AdminSectionPage({
  params,
  searchParams,
}: PageProps<"/admin/[section]">) {
  const { section } = await params;
  if (!adminSections.has(section as AdminSection)) notFound();

  return (
    <AdminDashboardContent
      searchParams={searchParams}
      section={section as AdminSection}
    />
  );
}
