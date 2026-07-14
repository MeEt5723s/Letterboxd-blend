import json
import time
import logging
from typing import Any, Optional
import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

class AsyncCacheLayer:
    def __init__(self):
        self.redis: Optional[aioredis.Redis] = None
        self.memory_cache = {}

    async def connect(self):
        try:
            self.redis = aioredis.from_url("redis://localhost:6379/0", socket_timeout=2)
            await self.redis.ping()
            logger.info("Connected to Redis successfully.")
        except Exception as e:
            logger.warning(f"Redis not available, using in-memory cache fallback: {e}")
            self.redis = None

    async def get(self, key: str) -> Optional[Any]:
        if self.redis:
            try:
                val = await self.redis.get(key)
                if val:
                    return json.loads(val)
            except Exception as e:
                logger.warning(f"Redis get error: {e}")
        
        # Memory fallback
        if key in self.memory_cache:
            val, expiry = self.memory_cache[key]
            if time.time() < expiry:
                return val
            else:
                del self.memory_cache[key]
        return None

    async def set(self, key: str, value: Any, ttl: int):
        if self.redis:
            try:
                await self.redis.setex(key, ttl, json.dumps(value))
                return
            except Exception as e:
                logger.warning(f"Redis set error: {e}")
        
        # Memory fallback
        self.memory_cache[key] = (value, time.time() + ttl)

cache = AsyncCacheLayer()
