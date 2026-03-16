<template>
  <div class="flex h-dvh min-h-screen flex-col bg-stone-100 text-stone-900 transition-colors dark:bg-stone-950 dark:text-stone-100">
    <main class="flex min-h-0 flex-1 overflow-hidden px-3 py-3 sm:px-4 sm:py-4 lg:px-4 lg:py-4">
      <div class="h-full min-h-0 w-full overflow-hidden">
        <RouterView />
      </div>
    </main>
  </div>
</template>
