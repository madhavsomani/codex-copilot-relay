# 1.3.17: explain model routes and show SDK credits

The dashboard now distinguishes the model Codex requested, the backend selected
by the relay, and models reported by SDK usage events. The header shows the
current routing policy and installation default. Old records keep their original
routes and are marked as belonging to an earlier relay run. The diagram reflects
the latest selected backend, not the installation default or an unselected request.

A requested Terra / selected Astra record means that request ran through the Astra
backend. Old forced-default records do not describe the current per-request policy.
Tool continuations can also keep an existing session's selected model. New records
retain relay version and routing policy alongside both model IDs, even after their
large bodies age out. Missing historical policy metadata is never invented.

Measured SDK AI credits are visible as a lifetime total, per model, in history,
and in the live and selected-call inspectors. The conversion is totalNanoAiu divided
by 1,000,000,000. These are reported usage units for traffic through this relay;
they are separate from the monthly account entitlement and public dollar benchmark.
Missing credit telemetry is displayed as not reported. An explicitly reported zero
remains zero. Existing lifetime credit totals are preserved; new metadata records
how many SDK usage events reported credits. Older zero values without that metadata
cannot be distinguished from missing data.

Live inspector usage accumulates within the current relay call. Durable totals
increase only when that call finalizes, so live events are not counted twice.
No UI libraries, extra inference calls, or polling loops were added to the dashboard.

Verification: 115 automated tests passed. Live Terra streaming and a two-step tool
chain passed. An isolated forced-route call survived a restart into per-request mode;
its old route stayed visible while new Terra calls selected and reported Terra.
The sum of per-call credits matched the lifetime total. Dashboard checks passed
at 1440px, 768px and 390px widths without page-level overflow or console errors.
