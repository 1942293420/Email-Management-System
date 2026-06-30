import json
import logging
from channels.generic.websocket import AsyncWebsocketConsumer

logger = logging.getLogger(__name__)


class EmailConsumer(AsyncWebsocketConsumer):

    async def connect(self):
        try:
            await self.channel_layer.group_add("email_events", self.channel_name)
            await self.accept()
            logger.info("WebSocket connected: %s", self.channel_name)
        except Exception as e:
            logger.error("WebSocket connect failed: %s", e)
            await self.close()

    async def disconnect(self, close_code):
        try:
            await self.channel_layer.group_discard("email_events", self.channel_name)
        except Exception:
            pass
        logger.info("WebSocket disconnected: %s (code=%s)", self.channel_name, close_code)

    async def email_notification(self, event):
        await self.send(text_data=json.dumps({
            "type": event["data"].get("event_type", "unknown"),
            "data": event["data"],
        }))
