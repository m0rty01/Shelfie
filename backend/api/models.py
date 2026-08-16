import uuid
from django.db import models


class CatalogBook(models.Model):
    """A book in the canonical reference catalog."""
    title = models.TextField()
    author = models.TextField()
    edition = models.TextField(blank=True, default="")
    alt_titles = models.TextField(blank=True, default="")  # pipe-separated alternate titles
    cover_url = models.URLField(blank=True, default="")

    class Meta:
        db_table = "catalog"

    def __str__(self):
        return f"{self.title} — {self.author}"


class LibraryBook(models.Model):
    """A book the user has confirmed into their personal library."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    catalog_book = models.ForeignKey(
        CatalogBook, null=True, blank=True, on_delete=models.SET_NULL
    )
    title = models.TextField()
    author = models.TextField()
    cover_url = models.URLField(blank=True, default="")
    spine_b64 = models.TextField(blank=True, default="")  # base64 jpg of detected spine
    confidence = models.FloatField(default=0.0)
    confirmed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "library"
        ordering = ["-confirmed_at"]

    def __str__(self):
        return f"{self.title} — {self.author}"
