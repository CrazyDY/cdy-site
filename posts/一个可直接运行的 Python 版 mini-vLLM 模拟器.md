这是一个**可直接运行的 Python 版 mini-vLLM 模拟器**：

<details>
  <summary><u><font color="#2440B3">mini_vllm.py</font></u></summary>
    ```python
    """
mini_vllm.py

一个用于理解 vLLM 核心机制的教学模拟器。

模拟：
1. 100 个并发 Agent 请求
2. Scheduler 的 token budget
3. Continuous Batching
4. Chunked Prefill
5. Paged KV Cache / Block Pool
6. Decode 每轮生成 1 token
7. 请求完成后的 KV Block 回收

注意：
- 这不是实际的大模型推理引擎。
- 不包含 CUDA / Attention / Tensor Parallel。
- GPU.execute() 只是模拟一次 model forward。
"""

from __future__ import annotations

import argparse
import math
import random
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Deque, Dict, Iterable, List, Optional


class RequestStatus(str, Enum):
    WAITING = "WAITING"
    RUNNING = "RUNNING"
    FINISHED = "FINISHED"


@dataclass
class Request:
    request_id: str
    prompt_tokens: int
    max_new_tokens: int

    status: RequestStatus = RequestStatus.WAITING
    computed_prompt_tokens: int = 0
    generated_tokens: int = 0

    # 逻辑 block -> 物理 block
    block_table: List[int] = field(default_factory=list)

    @property
    def total_computed_tokens(self) -> int:
        return self.computed_prompt_tokens + self.generated_tokens

    @property
    def remaining_prompt_tokens(self) -> int:
        return self.prompt_tokens - self.computed_prompt_tokens

    @property
    def is_prefill_done(self) -> bool:
        return self.computed_prompt_tokens >= self.prompt_tokens

    @property
    def is_finished(self) -> bool:
        return self.generated_tokens >= self.max_new_tokens

    @property
    def phase(self) -> str:
        if self.is_finished:
            return "finished"
        if not self.is_prefill_done:
            return "prefill"
        return "decode"


class KVCacheExhausted(RuntimeError):
    pass


class BlockPool:
    """
    模拟 GPU 中的 KV Cache Block Pool。

    每个 block 可以保存 block_size 个 token 的 KV。
    """

    def __init__(self, num_blocks: int, block_size: int) -> None:
        if num_blocks <= 0:
            raise ValueError("num_blocks must be > 0")
        if block_size <= 0:
            raise ValueError("block_size must be > 0")

        self.num_blocks = num_blocks
        self.block_size = block_size
        self._free_blocks: Deque[int] = deque(range(num_blocks))
        self._allocated_owner: Dict[int, str] = {}

    @property
    def free_count(self) -> int:
        return len(self._free_blocks)

    @property
    def used_count(self) -> int:
        return self.num_blocks - self.free_count

    def allocate(self, request: Request, target_total_tokens: int) -> List[int]:
        """
        确保 request 的 KV Cache 足够保存 target_total_tokens。

        只分配新增 block。
        """
        required_blocks = math.ceil(target_total_tokens / self.block_size)
        missing_blocks = required_blocks - len(request.block_table)

        if missing_blocks <= 0:
            return []

        if missing_blocks > self.free_count:
            raise KVCacheExhausted(
                f"{request.request_id} needs {missing_blocks} blocks, "
                f"but only {self.free_count} blocks are free"
            )

        allocated: List[int] = []
        for _ in range(missing_blocks):
            block_id = self._free_blocks.popleft()
            self._allocated_owner[block_id] = request.request_id
            request.block_table.append(block_id)
            allocated.append(block_id)

        return allocated

    def release(self, request: Request) -> List[int]:
        released = list(request.block_table)

        for block_id in released:
            owner = self._allocated_owner.pop(block_id, None)
            if owner != request.request_id:
                raise RuntimeError(
                    f"block ownership corrupted: block={block_id}, "
                    f"expected={request.request_id}, actual={owner}"
                )
            self._free_blocks.append(block_id)

        request.block_table.clear()
        return released


@dataclass
class ScheduledItem:
    request: Request
    num_tokens: int
    phase: str


@dataclass
class SchedulerOutput:
    items: List[ScheduledItem]
    token_budget: int

    @property
    def scheduled_tokens(self) -> int:
        return sum(item.num_tokens for item in self.items)

    @property
    def request_count(self) -> int:
        return len(self.items)


class Scheduler:
    """
    一个极简 vLLM 风格 Scheduler。

    策略：
    1. 优先调度 running 请求。
       - decode 请求每轮计算 1 token
       - 未完成 prefill 的请求执行 chunked prefill
    2. budget 和 max_num_seqs 尚有空间时，从 waiting queue 拉新请求。
    3. 调度前向 KV Cache Manager 申请对应 block。
    """

    def __init__(
        self,
        block_pool: BlockPool,
        max_num_batched_tokens: int,
        max_num_seqs: int,
        max_prefill_chunk: int,
    ) -> None:
        self.block_pool = block_pool
        self.max_num_batched_tokens = max_num_batched_tokens
        self.max_num_seqs = max_num_seqs
        self.max_prefill_chunk = max_prefill_chunk

        self.waiting: Deque[Request] = deque()
        self.running: List[Request] = []
        self.finished: List[Request] = []

    def add_request(self, request: Request) -> None:
        self.waiting.append(request)

    def _tokens_for_request(self, request: Request, remaining_budget: int) -> int:
        if remaining_budget <= 0:
            return 0

        if request.phase == "decode":
            return 1

        if request.phase == "prefill":
            return min(
                request.remaining_prompt_tokens,
                self.max_prefill_chunk,
                remaining_budget,
            )

        return 0

    def _try_schedule_request(
        self,
        request: Request,
        remaining_budget: int,
    ) -> Optional[ScheduledItem]:
        num_tokens = self._tokens_for_request(request, remaining_budget)

        if num_tokens <= 0:
            return None

        target_total_tokens = request.total_computed_tokens + num_tokens

        try:
            self.block_pool.allocate(request, target_total_tokens)
        except KVCacheExhausted:
            return None

        return ScheduledItem(
            request=request,
            num_tokens=num_tokens,
            phase=request.phase,
        )

    def schedule(self) -> SchedulerOutput:
        items: List[ScheduledItem] = []
        budget = self.max_num_batched_tokens

        # 1. running 请求优先。
        for request in list(self.running):
            if budget <= 0 or len(items) >= self.max_num_seqs:
                break

            item = self._try_schedule_request(request, budget)
            if item is None:
                continue

            items.append(item)
            budget -= item.num_tokens

        # 2. Continuous batching:
        # 当前 batch 未满时，将 waiting request 动态加入。
        waiting_attempts = len(self.waiting)

        for _ in range(waiting_attempts):
            if budget <= 0 or len(items) >= self.max_num_seqs:
                break

            request = self.waiting[0]
            item = self._try_schedule_request(request, budget)

            if item is None:
                # 当前请求因 KV 不足无法进入。
                # 将其放到队尾，尝试其他更小请求。
                self.waiting.rotate(-1)
                continue

            self.waiting.popleft()
            request.status = RequestStatus.RUNNING
            self.running.append(request)

            items.append(item)
            budget -= item.num_tokens

        return SchedulerOutput(
            items=items,
            token_budget=self.max_num_batched_tokens,
        )

    def update_after_execution(self, output: SchedulerOutput) -> List[Request]:
        newly_finished: List[Request] = []

        for item in output.items:
            request = item.request

            if item.phase == "prefill":
                request.computed_prompt_tokens += item.num_tokens
            elif item.phase == "decode":
                request.generated_tokens += item.num_tokens
            else:
                raise RuntimeError(f"unexpected phase: {item.phase}")

        for request in list(self.running):
            if not request.is_finished:
                continue

            request.status = RequestStatus.FINISHED
            self.running.remove(request)
            self.finished.append(request)
            self.block_pool.release(request)
            newly_finished.append(request)

        return newly_finished

    @property
    def done(self) -> bool:
        return not self.waiting and not self.running


class FakeGPU:
    """
    模拟 GPU Model Runner。

    真实 vLLM 会：
    - prepare input_ids / positions
    - prepare block tables / slot mappings
    - 执行 Transformer forward
    - 执行 paged attention
    - sampling

    这里仅打印一次 dynamic batch，然后由 Scheduler 更新 request state。
    """

    def execute(self, output: SchedulerOutput) -> None:
        if not output.items:
            return

        # 故意不 sleep。
        # 这是逻辑模拟器，不模拟真实 wall-clock latency。
        return


class MiniVLLMEngine:
    def __init__(
        self,
        num_kv_blocks: int = 20_000,
        block_size: int = 16,
        max_num_batched_tokens: int = 8192,
        max_num_seqs: int = 32,
        max_prefill_chunk: int = 2048,
        verbose_every: int = 1,
    ) -> None:
        self.block_pool = BlockPool(
            num_blocks=num_kv_blocks,
            block_size=block_size,
        )
        self.scheduler = Scheduler(
            block_pool=self.block_pool,
            max_num_batched_tokens=max_num_batched_tokens,
            max_num_seqs=max_num_seqs,
            max_prefill_chunk=max_prefill_chunk,
        )
        self.gpu = FakeGPU()
        self.iteration = 0
        self.verbose_every = max(1, verbose_every)

    def add_requests(self, requests: Iterable[Request]) -> None:
        for request in requests:
            self.scheduler.add_request(request)

    def _format_item(self, item: ScheduledItem) -> str:
        r = item.request
        if item.phase == "prefill":
            before = r.computed_prompt_tokens
            after = before + item.num_tokens
            return (
                f"{r.request_id}: PREFILL "
                f"{item.num_tokens:4d} tokens "
                f"[{before:5d}->{after:5d}/{r.prompt_tokens}]"
            )

        return (
            f"{r.request_id}: DECODE  "
            f"{item.num_tokens:4d} token  "
            f"[generated={r.generated_tokens}"
            f"/{r.max_new_tokens}]"
        )

    def _print_iteration(
        self,
        output: SchedulerOutput,
        newly_finished: List[Request],
    ) -> None:
        if self.iteration % self.verbose_every != 0 and not newly_finished:
            return

        prefill_tokens = sum(
            item.num_tokens for item in output.items if item.phase == "prefill"
        )
        decode_tokens = sum(
            item.num_tokens for item in output.items if item.phase == "decode"
        )

        print()
        print("=" * 88)
        print(f"ITERATION {self.iteration}")
        print("-" * 88)
        print(
            f"batch_requests={output.request_count:2d} | "
            f"scheduled_tokens={output.scheduled_tokens:5d}"
            f"/{output.token_budget} | "
            f"prefill={prefill_tokens:5d} | "
            f"decode={decode_tokens:3d}"
        )
        print(
            f"waiting={len(self.scheduler.waiting):3d} | "
            f"running={len(self.scheduler.running):3d} | "
            f"finished={len(self.scheduler.finished):3d} | "
            f"KV blocks used={self.block_pool.used_count:5d} | "
            f"free={self.block_pool.free_count:5d}"
        )

        # 避免 32 个请求全部刷屏，只展示前 12 个。
        for item in output.items[:12]:
            print("  ", self._format_item(item))

        if len(output.items) > 12:
            print(f"   ... {len(output.items) - 12} more scheduled items")

        if newly_finished:
            ids = ", ".join(r.request_id for r in newly_finished[:10])
            suffix = "" if len(newly_finished) <= 10 else ", ..."
            print(
                f"FINISHED & KV RELEASED: "
                f"{ids}{suffix}"
            )

    def run(self, max_iterations: int = 1_000_000) -> None:
        while not self.scheduler.done:
            self.iteration += 1

            if self.iteration > max_iterations:
                raise RuntimeError(
                    f"max_iterations={max_iterations} reached; "
                    "the scheduler may be stuck"
                )

            output = self.scheduler.schedule()

            if not output.items:
                raise RuntimeError(
                    "Scheduler made no progress. "
                    "Possible cause: KV cache is too small for every pending request."
                )

            self.gpu.execute(output)
            newly_finished = self.scheduler.update_after_execution(output)
            self._print_iteration(output, newly_finished)

        print()
        print("=" * 88)
        print("ALL REQUESTS FINISHED")
        print(
            f"iterations={self.iteration} | "
            f"finished={len(self.scheduler.finished)} | "
            f"KV used={self.block_pool.used_count} | "
            f"KV free={self.block_pool.free_count}"
        )


def build_agent_requests(
    num_requests: int,
    seed: int,
    prompt_min: int,
    prompt_max: int,
    output_min: int,
    output_max: int,
) -> List[Request]:
    rng = random.Random(seed)

    return [
        Request(
            request_id=f"agent-{i:03d}",
            prompt_tokens=rng.randint(prompt_min, prompt_max),
            max_new_tokens=rng.randint(output_min, output_max),
        )
        for i in range(1, num_requests + 1)
    ]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Educational mini-vLLM scheduler and paged KV cache simulator"
    )
    parser.add_argument("--requests", type=int, default=100)
    parser.add_argument("--seed", type=int, default=42)

    parser.add_argument("--prompt-min", type=int, default=256)
    parser.add_argument("--prompt-max", type=int, default=8000)
    parser.add_argument("--output-min", type=int, default=16)
    parser.add_argument("--output-max", type=int, default=128)

    parser.add_argument("--kv-blocks", type=int, default=20_000)
    parser.add_argument("--block-size", type=int, default=16)

    parser.add_argument("--max-num-batched-tokens", type=int, default=8192)
    parser.add_argument("--max-num-seqs", type=int, default=32)
    parser.add_argument("--max-prefill-chunk", type=int, default=2048)

    parser.add_argument(
        "--verbose-every",
        type=int,
        default=1,
        help="Print one scheduler iteration every N iterations",
    )

    return parser.parse_args()


def main() -> None:
    args = parse_args()

    requests = build_agent_requests(
        num_requests=args.requests,
        seed=args.seed,
        prompt_min=args.prompt_min,
        prompt_max=args.prompt_max,
        output_min=args.output_min,
        output_max=args.output_max,
    )

    print("MINI-vLLM CONFIG")
    print("-" * 88)
    print(
        f"requests={args.requests}, "
        f"token_budget={args.max_num_batched_tokens}, "
        f"max_num_seqs={args.max_num_seqs}"
    )
    print(
        f"KV blocks={args.kv_blocks}, "
        f"block_size={args.block_size}, "
        f"KV token capacity={args.kv_blocks * args.block_size}"
    )
    print(
        f"max_prefill_chunk={args.max_prefill_chunk}, "
        f"seed={args.seed}"
    )

    engine = MiniVLLMEngine(
        num_kv_blocks=args.kv_blocks,
        block_size=args.block_size,
        max_num_batched_tokens=args.max_num_batched_tokens,
        max_num_seqs=args.max_num_seqs,
        max_prefill_chunk=args.max_prefill_chunk,
        verbose_every=args.verbose_every,
    )
    engine.add_requests(requests)
    engine.run()


if __name__ == "__main__":
    main()

    ```
</details>

我已经实际跑过 100 个并发 Agent 的模拟，最终结果：

```text
ALL REQUESTS FINISHED
iterations=306
finished=100
KV used=0
KV free=20000
```

也就是说，请求全部完成后，20,000 个 KV Block 全部成功回收。

## 直接运行

```bash
python mini_vllm.py
```

默认模拟：

```text
100 个 Agent
Token Budget = 8192
max_num_seqs = 32
KV Blocks = 20000
Block Size = 16 tokens
Prefill Chunk = 2048 tokens
```

也可以自己修改参数：

```bash
python mini_vllm.py \
  --requests 100 \
  --kv-blocks 20000 \
  --block-size 16 \
  --max-num-batched-tokens 8192 \
  --max-num-seqs 32 \
  --max-prefill-chunk 2048
```

## 这个 mini-vLLM 实现了什么

核心对象关系是：

```text
MiniVLLMEngine
       │
       ├── Scheduler
       │       │
       │       ├── waiting queue
       │       ├── running requests
       │       └── finished requests
       │
       ├── BlockPool
       │       │
       │       ├── free blocks
       │       └── allocated blocks
       │
       └── FakeGPU
               │
               └── execute(dynamic batch)
```

代码里有 6 个值得重点看的类：

```python
Request
BlockPool
ScheduledItem
SchedulerOutput
Scheduler
MiniVLLMEngine
```

### 1. Request：一个 Agent 请求的状态

```python
@dataclass
class Request:
    request_id: str
    prompt_tokens: int
    max_new_tokens: int

    status: RequestStatus = RequestStatus.WAITING
    computed_prompt_tokens: int = 0
    generated_tokens: int = 0

    block_table: List[int] = field(default_factory=list)
```

比如：

```text
agent-001

prompt_tokens = 5000
computed_prompt_tokens = 2048
generated_tokens = 0
```

说明：

```text
Prompt 总长度：5000
已经 Prefill：2048
剩余 Prompt：2952
```

它当前的 phase：

```python
@property
def phase(self) -> str:
    if self.is_finished:
        return "finished"

    if not self.is_prefill_done:
        return "prefill"

    return "decode"
```

所以 Request 本质是：

```text
一个状态机

WAITING
   ↓
PREFILL
   ↓
DECODE
   ↓
FINISHED
```

---

## 2. BlockPool：模拟 Paged KV Cache

这是整个代码最关键的部分之一：

```python
self._free_blocks = deque(range(num_blocks))
```

假设：

```text
num_blocks = 10
```

开始：

```text
Free Block Pool

[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
```

Request A 需要保存 40 tokens。

```text
block_size = 16
```

需要：

```python
ceil(40 / 16)
= 3 blocks
```

代码：

```python
required_blocks = math.ceil(
    target_total_tokens / self.block_size
)
```

然后：

```python
block_id = self._free_blocks.popleft()

self._allocated_owner[block_id] = request.request_id

request.block_table.append(block_id)
```

结果：

```text
Request A

block_table = [0, 1, 2]
```

此时：

```text
Free Blocks

[3, 4, 5, 6, 7, 8, 9]
```

请求结束：

```python
self.block_pool.release(request)
```

Block 回收：

```text
[0, 1, 2]

↓ release

Free Block Pool
```

这就是极简版：

```text
Paged KV Cache Manager
```

---

## 3. Scheduler：mini-vLLM 的大脑

最核心的方法：

```python
def schedule(self) -> SchedulerOutput:
```

逻辑分两步。

第一步：

```python
for request in list(self.running):
```

优先处理 RUNNING Request。

例如：

```text
Agent 1 → Decode
Agent 2 → Decode
Agent 3 → Prefill
```

Scheduler 计算：

```python
_tokens_for_request()
```

Decode：

```python
if request.phase == "decode":
    return 1
```

也就是：

```text
Agent 1 → 1 token
Agent 2 → 1 token
```

Prefill：

```python
return min(
    request.remaining_prompt_tokens,
    self.max_prefill_chunk,
    remaining_budget,
)
```

例如：

```text
Agent 3

remaining prompt = 5000
max_prefill_chunk = 2048
budget = 8190
```

Scheduler：

```text
schedule 2048 tokens
```

所以形成：

```text
Agent 1   decode       1
Agent 2   decode       1
Agent 3   prefill   2048
```

---

## 4. Continuous Batching 在哪里？

就在这里：

```python
waiting_attempts = len(self.waiting)

for _ in range(waiting_attempts):
```

RUNNING 请求调度完以后：

```text
Token Budget = 8192

Running 消耗：

Agent 1 = 1
Agent 2 = 1
Agent 3 = 2048
```

剩余：

```text
6142 tokens
```

Scheduler 不会让 GPU 直接运行。

它继续：

```text
Waiting Queue
```

拿新的 Agent：

```python
request = self.waiting[0]
```

加入当前 Batch：

```python
self.waiting.popleft()

request.status = RequestStatus.RUNNING

self.running.append(request)

items.append(item)
```

因此：

```text
Iteration N

Agent 1 decode
Agent 2 decode
Agent 3 prefill
Agent 4 prefill
Agent 5 prefill
```

下一轮：

```text
Iteration N+1

Agent 1 decode
Agent 2 decode
Agent 3 prefill
Agent 4 decode
Agent 5 prefill
Agent 6 prefill
```

注意：

> Batch 已经发生变化。

这就是代码级别的 Continuous Batching。

---

## 5. GPU 在这个模拟器中的位置

```python
class FakeGPU:

    def execute(
        self,
        output: SchedulerOutput
    ) -> None:

        if not output.items:
            return

        return
```

这里故意什么都没干。

因为当前模拟的是：

```text
Scheduler
KV Cache
Request State
Continuous Batching
```

而不是真的：

```text
Transformer Forward
```

真实 vLLM 这里大致对应：

```text
SchedulerOutput
      ↓
GPU Model Runner
      ↓
prepare input_ids
prepare positions
prepare block tables
prepare slot mappings
      ↓
Transformer Forward
      ↓
Paged Attention
      ↓
LM Head
      ↓
Sampling
```

我们的 FakeGPU：

```python
self.gpu.execute(output)
```

可以理解为：

```text
假装 GPU 已经完成一次 Forward
```

然后：

```python
self.scheduler.update_after_execution(output)
```

更新状态。

Prefill：

```python
request.computed_prompt_tokens += item.num_tokens
```

Decode：

```python
request.generated_tokens += item.num_tokens
```

---

## 6. 实际输出怎么看

你运行后会看到类似：

```text
ITERATION 1
----------------------------------------------------------------------------------------
batch_requests= 4
scheduled_tokens= 8192/8192
prefill=8192
decode=0

waiting=96
running=4
finished=0

KV blocks used=512
free=19488
```

含义：

```text
第 1 轮 Scheduler

100 个 Request
↓
4 个进入 RUNNING
↓
共调度 8192 tokens
↓
全是 Prefill
↓
使用 512 KV Blocks
```

为什么正好 512？

```text
8192 / 16
= 512 blocks
```

下一轮可能看到：

```text
prefill=8188
decode=4
```

意思是：

```text
4 个已有 Request
↓
每个 Decode 1 token
↓
4 tokens

剩余 Budget
↓
8188 tokens

加入新 Request 做 Prefill
```

这其实非常形象地展示了：

```text
Decode
+
Prefill
+
Continuous Batching
```

---

## 我建议你读代码的顺序

不要从 `main()` 顺着看。

直接按这个顺序：

```text
第一遍
Request.phase

↓

第二遍
BlockPool.allocate()
BlockPool.release()

↓

第三遍
Scheduler._tokens_for_request()

↓

第四遍
Scheduler._try_schedule_request()

↓

第五遍
Scheduler.schedule()

↓

第六遍
Scheduler.update_after_execution()

↓

最后
MiniVLLMEngine.run()
```

尤其重点看：

```python
Scheduler.schedule()
```

**整个 mini-vLLM 最核心的代码基本就在这个方法里。**

下一步最有价值的是继续把这个模拟器升级成 **mini-vLLM V2**：不用 `FakeGPU`，而是接入 PyTorch，实现一个真正的小 Transformer，并让 `BlockPool.block_table` 真正控制 KV Cache Tensor 的读写。这样就能亲手实现一个简化版 **PagedAttention**。
