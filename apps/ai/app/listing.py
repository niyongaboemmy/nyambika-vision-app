"""AI listing writer (FR-PAGE-07, FR-AST-10): product titles/descriptions and page stories in RW/EN/FR.

Rules templates always work offline; with MUSE_LLM=1 the LLM drafts and the templates are the fallback.
Kinyarwanda and French templates need native-speaker review before the pilot.
"""
from . import llm

CAT = {
    "en": {"dress": "dress", "umushanana": "umushanana", "kitenge": "kitenge outfit", "shirt": "shirt", "skirt": "skirt",
           "top": "top", "suit": "suit", "kids": "children's outfit", "bridal": "bridal gown"},
    "fr": {"dress": "robe", "umushanana": "umushanana", "kitenge": "tenue en kitenge", "shirt": "chemise", "skirt": "jupe",
           "top": "haut", "suit": "costume", "kids": "tenue d'enfant", "bridal": "robe de mariée"},
    "rw": {"dress": "ikanzu", "umushanana": "umushanana", "kitenge": "umwambaro w'igitenge", "shirt": "ishati",
           "skirt": "ijipo", "top": "agapira", "suit": "ikoti n'ipantalo", "kids": "imyenda y'abana",
           "bridal": "ikanzu y'ubukwe"},
}
OCC = {
    "en": {"wedding": "weddings", "office": "the office", "church": "church", "party": "parties", "graduation": "graduations",
           "casual": "every day", "traditional-ceremony": "gusaba and traditional ceremonies"},
    "fr": {"wedding": "les mariages", "office": "le bureau", "church": "l'église", "party": "les fêtes",
           "graduation": "les remises de diplômes", "casual": "le quotidien", "traditional-ceremony": "les cérémonies traditionnelles"},
    "rw": {"wedding": "ubukwe", "office": "akazi", "church": "urusengero", "party": "ibirori", "graduation": "isozwa ry'amasomo",
           "casual": "buri munsi", "traditional-ceremony": "gusaba n'imihango gakondo"},
}


def _join(items: list[str], word: str) -> str:
    items = [i for i in items if i]
    return items[0] if len(items) == 1 else f"{', '.join(items[:-1])} {word} {items[-1]}" if items else ""


def product_rules(f: dict, locale: str) -> dict:
    cat = CAT[locale].get(f.get("category", ""), f.get("category", ""))
    colours = f.get("colours") or []
    occ = [OCC[locale].get(o, o) for o in f.get("occasions") or []]
    fabric = f.get("fabric") or ""
    mto = f.get("madeToOrder")
    days = f.get("leadTimeDays") or 0
    maker = f.get("makerName") or ""
    if locale == "fr":
        title = f"{cat.capitalize()} {colours[0].lower() if colours else ''} en wax".replace("  ", " ").strip()
        parts = [f"{cat.capitalize()} {('en ' + fabric) if fabric else 'en tissu wax'}"]
        if colours: parts.append(f"disponible en {_join([c.lower() for c in colours], 'et')}")
        text = " ".join(parts) + "."
        if occ: text += f" Idéal pour {_join(occ, 'et')}."
        text += f" Cousu sur mesure en {days} jours." if mto else " Prêt à porter."
        if maker: text += f" Créé par {maker}."
    elif locale == "rw":
        title = f"{cat.capitalize()} y'igitenge{(' ' + colours[0].lower()) if colours else ''}"
        text = f"{cat.capitalize()} {('ikozwe muri ' + fabric) if fabric else 'y’igitenge'}"
        if colours: text += f", iboneka mu mabara: {_join([c.lower() for c in colours], 'na')}"
        text += "."
        if occ: text += f" Ibereye {_join(occ, 'na')}."
        text += f" Idodwa ku bipimo byawe mu minsi {days}." if mto else " Yiteguye kwambarwa."
        if maker: text += f" Yakozwe na {maker}."
    else:
        title = f"{(colours[0] + ' ') if colours else ''}kitenge {cat}".strip().capitalize()
        text = f"{cat.capitalize()} in {fabric or 'wax-print kitenge'}"
        if colours: text += f", available in {_join([c.lower() for c in colours], 'and')}"
        text += "."
        if occ: text += f" Made for {_join(occ, 'and')}."
        text += f" Sewn to your measurements in {days} days." if mto else " Ready to wear."
        if maker: text += f" Made by {maker}."
    return {"title": title[:120], "description": text[:2000], "locale": locale, "writer": "rules"}


def story_rules(f: dict, locale: str) -> dict:
    name = f.get("name", "")
    kind = f.get("memberType", "TAILOR")
    place = ", ".join(x for x in [f.get("sector"), f.get("district")] if x)
    since = f.get("since")
    spec = f.get("specialty") or ""
    if locale == "fr":
        who = {"TAILOR": "atelier de couture", "COOPERATIVE": "coopérative de couturières", "SELLER": "boutique"}[kind]
        s = f"{name} est un(e) {who}{(' à ' + place) if place else ''}{(' depuis ' + str(since)) if since else ''}."
        if spec: s += f" Nous créons {spec}."
        s += " Chaque pièce est faite au Rwanda, et vous payez directement le créateur."
    elif locale == "rw":
        who = {"TAILOR": "inzu y'ubudozi", "COOPERATIVE": "koperative y'abadozi", "SELLER": "iduka ry'imyenda"}[kind]
        s = f"{name} ni {who}{(' iherereye ' + place) if place else ''}{(' kuva mu ' + str(since)) if since else ''}."
        if spec: s += f" Dukora {spec}."
        s += " Buri mwambaro ukorerwa mu Rwanda, kandi wishyura umudozi mu buryo butaziguye."
    else:
        who = {"TAILOR": "tailoring studio", "COOPERATIVE": "sewing cooperative", "SELLER": "fashion shop"}[kind]
        s = f"{name} is a {who}{(' in ' + place) if place else ''}{(' since ' + str(since)) if since else ''}."
        if spec: s += f" We make {spec}."
        s += " Every piece is made in Rwanda, and you pay the maker directly."
    return {"story": s[:1000], "locale": locale, "writer": "rules"}


PRODUCT_SCHEMA = {
    "type": "object",
    "properties": {"title": {"type": "string"}, "description": {"type": "string"}},
    "required": ["title", "description"],
    "additionalProperties": False,
}
STORY_SCHEMA = {"type": "object", "properties": {"story": {"type": "string"}}, "required": ["story"], "additionalProperties": False}
LANG = {"rw": "Kinyarwanda", "en": "English", "fr": "French"}


def write(kind: str, fields: dict, locale: str) -> dict:
    rules = product_rules(fields, locale) if kind == "product" else story_rules(fields, locale)
    if not llm.enabled():
        return rules
    try:
        if kind == "product":
            data = llm.generate_json(
                system=(f"You write product listings for Rwandan tailors and sellers, in {LANG[locale]}. Title under 60 "
                        "characters; description 2-3 plain sentences. Use only the facts given; never invent "
                        "materials, prices or claims."),
                user=str(fields),
                schema=PRODUCT_SCHEMA,
            )
            return {"title": data["title"][:120], "description": data["description"][:2000], "locale": locale, "writer": "llm"}
        data = llm.generate_json(
            system=(f"You write the short 'about' story for a Rwandan maker's page, in {LANG[locale]}, first person "
                    "plural, 2-4 sentences, warm and factual. Use only the facts given."),
            user=str(fields),
            schema=STORY_SCHEMA,
        )
        return {"story": data["story"][:1000], "locale": locale, "writer": "llm"}
    except Exception:  # noqa: BLE001 - fall back to templates
        return rules
