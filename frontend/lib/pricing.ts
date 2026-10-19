import { useEffect, useState } from "react";
import { COUNTRY_COOKIE } from "@/lib/countryCookie";

/**
 * Regional pricing: which currency a visitor sees and which payment options
 * are offered for it. The visitor's country comes from Vercel's
 * `x-vercel-ip-country` header, which `middleware.ts` copies into the
 * `metatron_country` cookie. These amounts are for display only; the backend
 * (`backend/src/routes/commerce.rs`) decides what is actually charged.
 */

export type Currency = "ZAR" | "USD" | "EUR";
export type PlanLevel = "basic" | "pro";
export type Billing = "monthly" | "annual";
export type PaymentMethod = "paystack" | "nowpayments";

const CURRENCY_CHOICE_KEY = "metatron_currency";

/** EU member states plus the EEA (NO, IS, LI) and Switzerland. */
const EUR_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "NO", "IS", "LI", "CH",
]);

const PRICES: Record<PlanLevel, Record<Billing, Record<Currency, number>>> = {
  basic: {
    monthly: { ZAR: 169.99, USD: 9.99, EUR: 8.99 },
    annual: { ZAR: 1699.99, USD: 99.99, EUR: 89.99 },
  },
  pro: {
    monthly: { ZAR: 339.99, USD: 19.99, EUR: 17.99 },
    annual: { ZAR: 3399.99, USD: 199.99, EUR: 179.99 },
  },
};

const SYMBOLS: Record<Currency, string> = { ZAR: "R", USD: "$", EUR: "€" };

/**
 * Paystack can only charge in ZAR for a South African business. Visitors
 * outside South Africa can still pay by card in ZAR, but only once
 * international payments are switched on in the Paystack dashboard, so the
 * option stays hidden until NEXT_PUBLIC_PAYSTACK_INTERNATIONAL_CARDS=1.
 */
const PAYSTACK_INTERNATIONAL_CARDS =
  process.env.NEXT_PUBLIC_PAYSTACK_INTERNATIONAL_CARDS === "1";

export function currencyForCountry(country: string | null): Currency {
  if (country === "ZA") return "ZAR";
  if (country && EUR_COUNTRIES.has(country)) return "EUR";
  return "USD";
}

/** ZAR is offered only to South African visitors; everyone can pick USD or EUR. */
export function currenciesForCountry(country: string | null): Currency[] {
  return country === "ZA" ? ["ZAR", "USD", "EUR"] : ["USD", "EUR"];
}

export function formatAmount(amount: number, currency: Currency): string {
  const digits = Number.isInteger(amount) ? 0 : 2;
  return `${SYMBOLS[currency]}${amount.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function planPrice(plan: PlanLevel, billing: Billing, currency: Currency) {
  return {
    price: formatAmount(PRICES[plan][billing][currency], currency),
    unit: `${currency} / ${billing === "monthly" ? "mo" : "yr"}`,
  };
}

export type PaymentOption = {
  method: PaymentMethod;
  label: string;
  note: string;
};

/** Payment options for a plan, in the order they should be shown. */
export function paymentOptions(
  plan: PlanLevel,
  billing: Billing,
  currency: Currency,
): PaymentOption[] {
  if (currency === "ZAR") {
    return [
      { method: "paystack", label: "Pay with card", note: "Visa & Mastercard · Powered by Paystack" },
    ];
  }
  const options: PaymentOption[] = [];
  if (PAYSTACK_INTERNATIONAL_CARDS) {
    const zar = formatAmount(PRICES[plan][billing].ZAR, "ZAR");
    options.push({
      method: "paystack",
      label: "Pay by card",
      note: `Charged ${zar} ZAR via Paystack · your bank converts`,
    });
  }
  options.push({
    method: "nowpayments",
    label: "Pay with crypto",
    note: "USDC, USDT & more · Powered by NowPayments",
  });
  return options;
}

export function checkoutFootnote(currency: Currency): string {
  if (currency === "ZAR") return "Pay with Visa or Mastercard via Paystack. Billed in ZAR.";
  return PAYSTACK_INTERNATIONAL_CARDS
    ? `Crypto is billed in ${currency}. Card payments are charged in ZAR via Paystack and converted by your bank.`
    : `Billed in ${currency} via NowPayments. Card payments in ${currency} are coming soon.`;
}

function readCountryCookie(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${COUNTRY_COOKIE}=([A-Z]{2})`));
  return match ? match[1] : null;
}

/**
 * The visitor's currency, defaulting from their country and remembering a
 * manual switch. `currency` is null until the browser has been read, so
 * prices don't flash in the wrong currency on first render.
 */
export function useRegionalCurrency() {
  const [country, setCountry] = useState<string | null>(null);
  const [currency, setCurrencyState] = useState<Currency | null>(null);

  useEffect(() => {
    const cc = readCountryCookie();
    const allowed = currenciesForCountry(cc);
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(CURRENCY_CHOICE_KEY);
    } catch {
      /* storage blocked: fall back to the country default */
    }
    setCountry(cc);
    setCurrencyState(
      saved && (allowed as string[]).includes(saved) ? (saved as Currency) : currencyForCountry(cc),
    );
  }, []);

  const setCurrency = (c: Currency) => {
    setCurrencyState(c);
    try {
      window.localStorage.setItem(CURRENCY_CHOICE_KEY, c);
    } catch {
      /* storage blocked: the choice just won't be remembered */
    }
  };

  return { country, currency, currencies: currenciesForCountry(country), setCurrency };
}
