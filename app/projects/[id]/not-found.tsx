import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function ProjectNotFound() {
  return (
    <section
      data-testid="project-not-found"
      className="flex flex-1 items-center justify-center p-8"
    >
      <div className="mx-auto w-full max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Project not found
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The project you're looking for doesn't exist or has been deleted.
        </p>
        <div className="mt-6 flex justify-center">
          <Link href="/">
            <Button variant="outline">Back to home</Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
