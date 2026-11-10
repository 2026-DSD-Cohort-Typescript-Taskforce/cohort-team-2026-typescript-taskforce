import { createClient } from "@supabase/supabase-js";


const storage = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
).storage.from("bill-documents");


export async function uploadBillPdf(path: string, token: string, file: File) {
  const { error } = await storage.uploadToSignedUrl(path, token, file, { contentType: "application/pdf" });
  return error ? "Couldn't upload the PDF. Try again." : null;
}