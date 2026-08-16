"""
Tests for the catalog fuzzy-matching logic in api/views.py.

Run with:
    cd backend
    python3 -m pytest tests/test_matching.py -v

We focus on the hard cases the spec explicitly requires:
- Two editions of the same book
- Same title published under two different titles (US/UK editions)
- Two genuinely different books that share a title
- Titles that are substrings of other titles
- Author names in different forms (initials, Lastname/Firstname order)
"""
import sys
import os

import django

# Make sure Django settings are configured before importing models
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "shelfie.settings")
os.path.sys = sys  # noqa
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
django.setup()

from api.views import match_catalog, CONFIDENCE_HIGH, CONFIDENCE_MIN
from api.models import CatalogBook


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_books(*specs):
    """Create in-memory CatalogBook objects (unsaved) from (title, author) pairs."""
    books = []
    for i, (title, author, *rest) in enumerate(specs):
        b = CatalogBook.__new__(CatalogBook)
        b.pk = i + 1
        b.title = title
        b.author = author
        b.alt_titles = rest[0] if rest else ""
        b.cover_url = ""
        books.append(b)
    return books


# ---------------------------------------------------------------------------
# 1. Exact / near-exact match
# ---------------------------------------------------------------------------

def test_exact_title_and_author():
    catalog = make_books(
        ("The Great Gatsby", "F. Scott Fitzgerald"),
        ("To Kill a Mockingbird", "Harper Lee"),
    )
    book, conf = match_catalog("The Great Gatsby", "F. Scott Fitzgerald", catalog)
    assert book is not None
    assert book.title == "The Great Gatsby"
    assert conf >= CONFIDENCE_HIGH, f"Expected high confidence, got {conf:.2f}"


# ---------------------------------------------------------------------------
# 2. Two editions of the same book — matcher should still find the canonical entry
# ---------------------------------------------------------------------------

def test_alternate_edition_matches():
    catalog = make_books(
        ("Harry Potter and the Philosopher's Stone", "J.K. Rowling"),
        ("Harry Potter and the Sorcerer's Stone", "J.K. Rowling"),  # US edition
    )
    # OCR reads "Sorcerer's Stone" — should still match one of the two
    book, conf = match_catalog("Harry Potter and the Sorcerers Stone", "J K Rowling", catalog)
    assert book is not None, "Should match at least one edition"
    assert conf >= CONFIDENCE_MIN, f"Confidence too low: {conf:.2f}"


# ---------------------------------------------------------------------------
# 3. Author name in different forms
# ---------------------------------------------------------------------------

def test_author_initials_vs_full_name():
    catalog = make_books(
        ("1984", "George Orwell"),
        ("Animal Farm", "George Orwell"),
    )
    # OCR reads "G. Orwell"
    book, conf = match_catalog("1984", "G. Orwell", catalog)
    assert book is not None
    assert book.title == "1984"
    assert conf >= CONFIDENCE_HIGH


def test_author_lastname_firstname_order():
    catalog = make_books(
        ("Crime and Punishment", "Fyodor Dostoevsky"),
    )
    # OCR reads "Dostoevsky, Fyodor"
    book, conf = match_catalog("Crime and Punishment", "Dostoevsky Fyodor", catalog)
    assert book is not None
    assert conf >= CONFIDENCE_HIGH


# ---------------------------------------------------------------------------
# 4. Title that is a substring of another title — should not cause wrong match
# ---------------------------------------------------------------------------

def test_substring_title_disambiguation():
    catalog = make_books(
        ("It", "Stephen King"),
        ("It Ends with Us", "Colleen Hoover"),
        ("It Starts with Us", "Colleen Hoover"),
    )
    book, conf = match_catalog("It Ends with Us", "Colleen Hoover", catalog)
    assert book is not None
    assert "Ends" in book.title, f"Wrong match: {book.title!r}"


# ---------------------------------------------------------------------------
# 5. Unreadable / empty OCR → no match, zero confidence
# ---------------------------------------------------------------------------

def test_empty_ocr_returns_no_match():
    catalog = make_books(
        ("The Great Gatsby", "F. Scott Fitzgerald"),
    )
    book, conf = match_catalog("", "", catalog)
    assert book is None
    assert conf == 0.0


# ---------------------------------------------------------------------------
# 6. Completely wrong title → confidence below auto-add threshold
# ---------------------------------------------------------------------------

def test_garbage_input_low_confidence():
    catalog = make_books(
        ("Pride and Prejudice", "Jane Austen"),
        ("Sense and Sensibility", "Jane Austen"),
    )
    # Total gibberish from a blurry spine
    book, conf = match_catalog("xQzAbcDef 999", "zzzUnknown", catalog)
    assert conf < CONFIDENCE_HIGH, f"Should not auto-add garbage: conf={conf:.2f}"


# ---------------------------------------------------------------------------
# 7. Fuzzy typo tolerance — OCR misread a character or two
# ---------------------------------------------------------------------------

def test_ocr_typo_tolerance():
    catalog = make_books(
        ("The Hitchhiker's Guide to the Galaxy", "Douglas Adams"),
    )
    # OCR misread: dropped apostrophe, extra space
    book, conf = match_catalog("Hitchhickers Guide to Galaxy", "Douglas Adams", catalog)
    assert book is not None
    assert conf >= CONFIDENCE_HIGH, f"Expected high conf with minor typo, got {conf:.2f}"


# ---------------------------------------------------------------------------
# 8. Empty catalog → graceful return
# ---------------------------------------------------------------------------

def test_empty_catalog():
    book, conf = match_catalog("Anything", "Anyone", [])
    assert book is None
    assert conf == 0.0
