from django.apps import AppConfig
from pathlib import Path
import csv
import logging

logger = logging.getLogger("shelfie")


class ApiConfig(AppConfig):
    name = "api"

    def ready(self):
        """Seed the catalog from catalog.csv on first startup if the table is empty."""
        try:
            from .models import CatalogBook
            if CatalogBook.objects.exists():
                return

            from django.conf import settings
            csv_path: Path = settings.CATALOG_CSV
            if not csv_path.exists():
                logger.warning("catalog.csv not found at %s", csv_path)
                return

            books = []
            with csv_path.open(newline="", encoding="utf-8") as f:
                for row in csv.DictReader(f):
                    books.append(CatalogBook(
                        id=int(row.get("id", 0) or 0) or None,
                        title=row.get("title", "").strip(),
                        author=row.get("author", "").strip(),
                        edition=(row.get("edition") or "").strip(),
                        alt_titles=(row.get("alt_titles") or row.get("alternate_titles") or "").strip(),
                        cover_url=(row.get("cover_url") or "").strip(),
                    ))

            # Bulk insert — ignore id=0/None entries
            valid = [b for b in books if b.title]
            CatalogBook.objects.bulk_create(valid, ignore_conflicts=True)
            logger.info("Seeded catalog with %d books", len(valid))
        except Exception as exc:
            # Don't crash startup if seeding fails
            logger.warning("Catalog seeding error (may be fine on first makemigrations): %s", exc)
