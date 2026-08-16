from rest_framework import serializers
from .models import CatalogBook, LibraryBook


class CatalogBookSerializer(serializers.ModelSerializer):
    class Meta:
        model = CatalogBook
        fields = ["id", "title", "author", "edition", "alt_titles", "cover_url"]


class LibraryBookSerializer(serializers.ModelSerializer):
    catalog_id = serializers.PrimaryKeyRelatedField(
        source="catalog_book", read_only=True
    )
    confirmed_at = serializers.DateTimeField(format="%Y-%m-%dT%H:%M:%SZ")

    class Meta:
        model = LibraryBook
        fields = [
            "id", "catalog_id", "title", "author",
            "cover_url", "spine_b64", "confidence", "confirmed_at",
        ]


class ConfirmRequestSerializer(serializers.Serializer):
    catalog_id = serializers.IntegerField(required=False, allow_null=True)
    title = serializers.CharField()
    author = serializers.CharField()
    cover_url = serializers.URLField(required=False, allow_blank=True, default="")
    spine_b64 = serializers.CharField(required=False, allow_blank=True, default="")
    confidence = serializers.FloatField(default=1.0)
