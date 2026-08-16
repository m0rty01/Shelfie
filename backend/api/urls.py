from django.urls import path
from . import views

urlpatterns = [
    path("",           views.HealthView.as_view(),          name="health"),
    path("scan",       views.ScanView.as_view(),            name="scan"),
    path("library",    views.LibraryListView.as_view(),     name="library-list"),
    path("library/confirm", views.LibraryConfirmView.as_view(), name="library-confirm"),
    path("library/<str:book_id>", views.LibraryDetailView.as_view(), name="library-detail"),
    path("catalog",    views.CatalogSearchView.as_view(),   name="catalog-search"),
]
