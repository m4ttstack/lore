---
name: storefront-checkout-review
description: Use when reviewing a merge request that touches apps/web/src/checkout/ in the storefront monorepo.
---

# Reviewing checkout changes

Read this whole skill before reviewing. Then:

1. Check out the branch and run `pnpm test --filter checkout`.
2. Open the preview environment and place a test order with card 4242 4242 4242 4242.
3. Read the diff top to bottom, then grade it against the items below.
4. If anything is unclear, ask the author in the MR before blocking.
5. Post findings grouped by severity; tag each `[BLOCKING]` or `[NON-BLOCKING]`.

For pricing questions, run the `pricing-deep-dive` skill in a subagent and paste its verdict.

## 1. Displayed prices come from the quote `[BLOCKING]`

The total a customer sees must come from the `Quote` object that produced it (`quote.total`, `quote.lines[i].amount`). Recomputing a total from line items drops quote-level discounts, so the customer sees one number and is charged another (this shipped once, see !4120). Signal: new code that sums `price * quantity`, or calls `computeTotal(`.

## 2. Money is integer minor units `[BLOCKING]`

Amounts are integers in cents. `parseFloat(`, `toFixed(`, `Number(` on an amount, or a `0.01` literal near money are wrong. Use `Money.fromCents` and `formatMoney`.

## 3. The GraphQL fragment selects what the component reads `[usually BLOCKING]`

When a component starts reading a field (`order.shippingMethod`, `quote.taxBreakdown`), the colocated `.graphql` fragment must select it, or it is `undefined` in production even though unit tests (which hand-build fixtures) pass. You cannot see this from the added lines alone: open the fragment file and compare.

## 4. Use the checkout hooks, not raw context `[NON-BLOCKING, raised on most MRs]`

Prefer `useCart()`, `useQuote()` and `useCheckoutStep()` over `useContext(CheckoutContext)`. Reaching into the context directly skips the hooks' null handling.

## 5. Payment provider calls go through the server `[BLOCKING]`

The browser never calls the payment provider directly. Any `fetch('https://api.payprovider.com` or import of `@payprovider/sdk` under apps/web is wrong; those calls belong in apps/api/src/payments/, which also must never log a full card number (`console.log` of a `card` object in apps/api/src/payments/ is a finding).

## 6. Removing a feature flag `[NON-BLOCKING]`

To remove a flag: delete its reads, then its definition in `flags.ts`, then the flag in the admin console, in that order. A removed `isEnabled('` line without the definition removed is the usual slip.

## 7. Keep the diff honest

No unrelated formatting changes; prettier runs in CI, so formatting is enforced there.
