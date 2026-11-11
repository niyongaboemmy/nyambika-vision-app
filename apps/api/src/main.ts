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
