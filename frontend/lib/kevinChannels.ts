import { API_BASE } from "@/lib/api";

// Dev and prod run separate WhatsApp numbers; the API base tells them apart.
const IS_DEV_API = /dev-api|localhost/.test(API_BASE);
export const KEVIN_WHATSAPP = IS_DEV_API ? "https://wa.me/27818621473" : "https://wa.me/15559439544";
export const KEVIN_TELEGRAM = "https://t.me/Kevinmetatron_bot";
