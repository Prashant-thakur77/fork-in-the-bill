# apache__parquet-java-3645 (control)

Source: `runs/exp1/transcripts/apache__parquet-java-3645__a1.json`. Rendered by `tools/render_transcript.py`; nothing here is edited by hand.

| | |
|---|---|
| Arm (served by Flagsmith) | `control` |
| Outcome | solved (`solved`) |
| Cost | $0.0343 (planner $0.0200, worker $0.0142) |
| Planner turns, worker jobs | 4, 1 |
| Language | java |

## The task given to the planner

```
<issue>
Handle NoClassDefFoundError in Dyn* classes
### Describe the bug, including details regarding any error messages, version, and platform.

All of the `Dyn*` classes use `Class.forName(className, true, loader)` and catch `ClassNotFoundException` when probing for optional implementations by class name, but `Class.forName` can also throw `NoClassDefFoundError` when the class itself is found but one of its transitive dependencies is missing. It can also throw `ExceptionInInitializerError` when the static initializer of the loaded class fails. 
We're intentionally not handling `ExceptionInInitializerError` and propagate it to the caller.

`DynConstructors` already handles `ClassNotFoundException` and `NoClassDefFoundError` while `DynMethods` only handles `ClassNotFoundException`

This issue is similar to https://github.com/apache/iceberg/pull/16793 and https://github.com/apache/iceberg/pull/16611 that we're fixing on the Iceberg side.

### Component(s)

Core

</issue>

The repository is at /testbed.
```

### Step 1: worker job

```json
{
  "instruction": "In /testbed, find all Java files named Dyn*.java (DynMethods, DynConstructors, DynFields, etc.) and grep for 'ClassNotFoundException' in them. Report file paths, line numbers and surrounding code (10 lines) of each catch of ClassNotFoundException.",
  "paths": []
}
```

Worker's answer:

```
{"summary":"Four catches of ClassNotFoundException in Dyn*.java files. They are in DynConstructors.java and DynMethods.java, both under parquet-common/src/main/java/org/apache/parquet/util/. DynFields.java has none. Each catch sits in a builder method that loads a class by name with Class.forName(className, true, loader). The two DynConstructors catches also catch NoClassDefFoundError.","findings":["DynConstructors.java:134, in Builder.impl(String className, Class<?>... types). The code is `try { Class<?> targetClass = Class.forName(className, true, loader); impl(targetClass, types); } catch (NoClassDefFoundError | ClassNotFoundException e) { // cannot load this implementation  problems.put(className, e); } return this;`. It is preceded by an early return `if (ctor != null) return this;`.","DynConstructors.java:172, in Builder.hiddenImpl(String className, Class<?>... types), which has @SuppressWarnings(\"unchecked\"). It has the same structure as the catch at line 134. It uses a raw `Class targetClass`, calls hiddenImpl(targetClass, types), and catches `NoClassDefFoundError | ClassNotFoundException`. It records the failure with problems.put(className, e).","DynMethods.java:246, in Builder.impl(String className, String methodName, Class<?>... argClasses). The code is `try { Class<?> targetClass = Class.forName(className, true, loader); impl(targetClass, methodName, argClasses); } catch (ClassNotFoundException e) { // class not found on supplied classloader.  LOG.debug(\"failed
… [431 more characters in the JSON file]
```

### Step 2: edit_file

```json
{
  "path": "/testbed/parquet-common/src/main/java/org/apache/parquet/util/DynMethods.java",
  "old": "      } catch (ClassNotFoundException e) {\n        // class not found on supplied classloader.\n        LOG.debug(\"failed to load class {}\", className, e);\n      }\n      return this;\n    }\n\n    /**\n     * Checks for an implementation, first finding the given class by name.\n     *\n     * @param className   name of a class\n     * @param methodName  name of a method (different from constructor)\n     * @param argClasses  argument classes for the method\n     * @return this Builder for method chaining\n     */\n    public Builder impl(String className, Class<?>... argClasses) {",
  "new": "      } catch (ClassNotFoundException | NoClassDefFoundError e) {\n        // class not found on supplied classloader.\n        LOG.debug(\"failed to load class {}\", className, e);\n      }\n      return this;\n    }\n\n    /**\n     * Checks for an implementation, first finding the given class by name.\n     *\n     * @param className   name of a class\n     * @param methodName  name of a method (different from constructor)\n     * @param argClasses  argument classes for the method\n     * @return this Builder for method chaining\n     */\n    public Builder impl(String className, Class<?>... argClasses) {"
}
```

### Step 3: view_file

```json
{
  "path": "/testbed/parquet-common/src/main/java/org/apache/parquet/util/DynMethods.java",
  "start_line": 350,
  "end_line": 362
}
```

Result (error):

```
error: old text not found
```

Result:

```
   350        }
   351  
   352        try {
   353          Class<?> targetClass = Class.forName(className, true, loader);
   354          hiddenImpl(targetClass, methodName, argClasses);
   355        } catch (ClassNotFoundException e) {
   356          // class not found on supplied classloader.
   357          LOG.debug("failed to load class {}", className, e);
   358        }
   359        return this;
   360      }
   361  
   362      /**
[lines 350-362 of 511]
```

### Step 4: edit_file

```json
{
  "path": "/testbed/parquet-common/src/main/java/org/apache/parquet/util/DynMethods.java",
  "old": "        hiddenImpl(targetClass, methodName, argClasses);\n      } catch (ClassNotFoundException e) {",
  "new": "        hiddenImpl(targetClass, methodName, argClasses);\n      } catch (ClassNotFoundException | NoClassDefFoundError e) {"
}
```

### Step 5: edit_file

```json
{
  "path": "/testbed/parquet-common/src/main/java/org/apache/parquet/util/DynMethods.java",
  "old": "        impl(targetClass, methodName, argClasses);\n      } catch (ClassNotFoundException e) {",
  "new": "        impl(targetClass, methodName, argClasses);\n      } catch (ClassNotFoundException | NoClassDefFoundError e) {"
}
```

Result:

```
edited /testbed/parquet-common/src/main/java/org/apache/parquet/util/DynMethods.java
```

Result:

```
edited /testbed/parquet-common/src/main/java/org/apache/parquet/util/DynMethods.java
```

### Step 6: submit

```json
{}
```

Result:

```
submitted
```

## The patch that was graded

```diff
diff --git a/parquet-common/src/main/java/org/apache/parquet/util/DynMethods.java b/parquet-common/src/main/java/org/apache/parquet/util/DynMethods.java
index 082f058..0d07283 100644
--- a/parquet-common/src/main/java/org/apache/parquet/util/DynMethods.java
+++ b/parquet-common/src/main/java/org/apache/parquet/util/DynMethods.java
@@ -243,7 +243,7 @@ public class DynMethods {
       try {
         Class<?> targetClass = Class.forName(className, true, loader);
         impl(targetClass, methodName, argClasses);
-      } catch (ClassNotFoundException e) {
+      } catch (ClassNotFoundException | NoClassDefFoundError e) {
         // class not found on supplied classloader.
         LOG.debug("failed to load class {}", className, e);
       }
@@ -352,7 +352,7 @@ public class DynMethods {
       try {
         Class<?> targetClass = Class.forName(className, true, loader);
         hiddenImpl(targetClass, methodName, argClasses);
-      } catch (ClassNotFoundException e) {
+      } catch (ClassNotFoundException | NoClassDefFoundError e) {
         // class not found on supplied classloader.
         LOG.debug("failed to load class {}", className, e);
       }
```
