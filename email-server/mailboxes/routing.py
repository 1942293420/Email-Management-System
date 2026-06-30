from django.urls import re_path
from .consumers import EmailConsumer

websocket_urlpatterns = [
    re_path(r"ws/events/$", EmailConsumer.as_asgi()),
]
