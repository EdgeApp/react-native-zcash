using ReactNative.Bridge;
using System;
using System.Collections.Generic;
using Windows.ApplicationModel.Core;
using Windows.UI.Core;

namespace Zcash.RNZcash
{
    /// <summary>
    /// A module that allows JS to share data.
    /// </summary>
    class RNZcashModule : NativeModuleBase
    {
        /// <summary>
        /// Instantiates the <see cref="RNZcashModule"/>.
        /// </summary>
        internal RNZcashModule()
        {

        }

        /// <summary>
        /// The name of the native module.
        /// </summary>
        public override string Name
        {
            get
            {
                return "RNZcash";
            }
        }
    }
}
