import { Global, Module } from "@nestjs/common";
import { Access } from "./auth";

@Global()
@Module({ providers: [Access], exports: [Access] })
export class CommonModule {}
