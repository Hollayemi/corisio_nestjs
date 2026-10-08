// src/stores/public-stores.controller.ts (new)
import { Controller, Get, Param, Query } from "@nestjs/common";
import { StoreDiscoveryService } from "./store-discovery.service.js";
import type { ListPublicStoresDto } from "./dto/list-public-stores.dto.js";
import { UserLocation } from "../common/decorator/user-location.decorator.js";
import type { Coords } from "../common/decorator/user-location.decorator.js";

@Controller("catalog/stores")
export class PublicStoresController {
    constructor(private stores: StoreDiscoveryService) { }

    @Get()
    async list(@Query() dto: any, @UserLocation() here: Coords) {
        return { message: "OK", data: await this.stores.listPublic(dto, here) };
    }

    @Get(":slug")
    async detail(@Param("slug") slug: string, @UserLocation() here: Coords) {
        return { message: "OK", data: await this.stores.getPublic(slug, here) };
    }
}