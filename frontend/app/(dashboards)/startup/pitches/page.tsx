import { redirect } from "next/navigation";

// Pitch data now lives on the Startup Profile page; keep old links working.
export default function StartupPitchesRedirect() {
  redirect("/startup/profile");
}
