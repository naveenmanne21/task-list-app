import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";

export default async function Home() {
  redirect((await getCurrentUser()) ? "/tasks" : "/login");
}
