import { redirect } from "next/navigation";

export default async function VerifyPhonePage() {
  redirect("/account/verification");
}
