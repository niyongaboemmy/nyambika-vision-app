# Try-on quality

<!-- metrics:start -->
| Garment (category sent) | Run | Readiness (exposure) | Placement err % | Undershirt leak % | Aspect distortion % | Guard pass /5 (reasons) | Latency ms |
|---|---|---|---|---|---|---|---|
| tee-brown (`t-shirt`) | before | READY (ok) | 6.11 | 9.97 | 119.76 | 5 (-) | 44.8 |
| tee-brown (`t-shirt`) | after | READY (ok) | 1.13 | 0 | 22.94 | 5 (-) | 125.2 |
| kitenge-dress (`Kitenge dress`) | before | READY (ok) | 0.91 | 9.82 | 22.14 | 5 (-) | 42.8 |
| kitenge-dress (`Kitenge dress`) | after | READY (ok) | 0.91 | 0 | 8.42 | 5 (-) | 134.4 |
| skirt (`skirt`) | before | READY (ok) | 4.08 | n/a | 12.4 | 5 (-) | 40 |
| skirt (`skirt`) | after | READY (ok) | 0.91 | n/a | 16.48 | 5 (-) | 87.4 |
| shirt (`shirt`) | before | READY (ok) | 0.91 | 0.25 | 24.1 | 5 (-) | 75.8 |
| shirt (`shirt`) | after | READY (ok) | 1 | 0 | 7.8 | 5 (-) | 124.6 |
| tee-dark (`tee`) | before | READY (ok) | 6.11 | 9.91 | 119.76 | 5 (-) | 41 |
| tee-dark (`tee`) | after | READY (ok) | 1.13 | 0 | 22.74 | 5 (-) | 127.2 |
| tee-light (`Polo`) | before | READY (ok) | 6.11 | 10.15 | 119.38 | 5 (-) | 42.8 |
| tee-light (`Polo`) | after | READY (ok) | 1.13 | 0 | 23.46 | 5 (-) | 133.2 |
| tee-mid (`(empty)`) | before | READY (ok) | 6.11 | 9.98 | 119.76 | 5 (-) | 40.8 |
| tee-mid (`(empty)`) | after | READY (ok) | 1.13 | 0 | 22.58 | 5 (-) | 130.2 |
| real-tee (`T-Shirt`) | before | NEEDS_BETTER_PHOTO (fail) | 6.56 | 7.59 | 98.7 | 5 (-) | 48.8 |
| real-tee (`T-Shirt`) | after | READY (ok) | 1.13 | 0 | 18.4 | 5 (-) | 154.6 |

HD tier (1024 px) mean latency, tee on all personas: before 85.2 ms, after 300.6 ms.
<!-- metrics:end -->
