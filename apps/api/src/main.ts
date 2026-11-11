import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { json, type NextFunction, type Request, type Response } from "express";
import { AppModule } from "./app.module";
import { config } from "./config";
import { httpDuration } from "./common/metrics";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Migration bundles may embed product photos (base64); everything else stays small.
  app.use("/admin/migration", json({ limit: "40mb" }));
  // Partner try-on (E37) sends one garment image as base64 (≤ 10 MB decoded).
  app.use("/v1/partner", json({ limit: "15mb" }));
  // Video try-on (E39) sends the shopper clip as ≤ 24 device-extracted frames.
  app.use("/video", json({ limit: "6mb" }));
  // E40: Stripe webhook signatures are computed over the raw body.
  app.use("/stripe/webhook", json({ limit: "1mb", verify: (req, _res, buf) => void ((req as Request & { rawBody?: Buffer }).rawBody = buf) }));
  app.use(json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use((req: Request, res: Response, next: NextFunction) => {
    const end = httpDuration.startTimer();
    res.on("finish", () => end({ method: req.method, route: (req.route?.path as string) ?? "unmatched", status: String(res.statusCode) }));
    next();
  });
  app.enableShutdownHooks();
  await app.listen(config.port);
  Logger.log(`Nyambika API on http://localhost:${config.port}`, "Bootstrap");
}
bootstrap();
